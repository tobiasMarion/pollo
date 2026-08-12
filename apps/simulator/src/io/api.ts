import {
  type EventWire,
  eventWireSchema,
  type Participant,
  participantSchema,
  socketPaths,
} from '@pollo/contracts'
import { z } from 'zod'

/**
 * How long to keep trying to reach the API before giving up.
 *
 * Not politeness — a race. `just simulate` depends on `contracts`, which
 * rewrites `packages/contracts/dist`, and the API watches that directory: the
 * rebuild restarts it, and the first request lands in the second or two while
 * the port is free. Hot reload is the point of that arrangement, so the client
 * is what has to tolerate it.
 */
const CONNECT_TIMEOUT_MS = 20_000
const CONNECT_RETRY_MS = 500

const RETRYABLE = new Set(['ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND'])

function isTransient(error: unknown): boolean {
  if (error instanceof AggregateError) return error.errors.every(isTransient)

  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code) return RETRYABLE.has(code)

    return error.cause !== undefined && isTransient(error.cause)
  }

  return false
}

/**
 * `GET /events/:eventId` is the one public event route, so the simulator can
 * resolve an event's origin with nothing but its id — no token, no OAuth on the
 * load-test path.
 */
export async function fetchEvent(
  apiUrl: string,
  eventId: string,
  onWaiting?: (reason: string) => void,
): Promise<EventWire> {
  const url = new URL(`/events/${eventId}`, apiUrl)
  const deadline = Date.now() + CONNECT_TIMEOUT_MS

  let response: Response | null = null
  let announced = false

  while (response === null) {
    try {
      response = await fetch(url)
    } catch (cause) {
      const detail = describe(cause)

      if (!isTransient(cause) || Date.now() >= deadline) {
        throw new Error(`Cannot reach the API at ${apiUrl} — ${detail}`, { cause })
      }

      if (!announced) {
        announced = true
        onWaiting?.(`waiting for the API at ${apiUrl} (${detail})`)
      }

      await new Promise(resolve => setTimeout(resolve, CONNECT_RETRY_MS))
    }
  }

  if (response.status === 404) {
    throw new Error(`No event with id ${eventId}.`)
  }

  if (!response.ok) {
    throw new Error(`The API answered ${response.status} for ${url.pathname}.`)
  }

  const body = z.object({ event: eventWireSchema }).safeParse(await response.json())

  if (!body.success) {
    throw new Error(`The API answered with a body this simulator cannot read: ${body.error}`)
  }

  return body.data.event
}

/**
 * Everybody already in the event, which is how a device learns about the people
 * who were there before it arrived.
 *
 * `USER_JOINED` only ever names arrivals, so without this a phone would know
 * nothing about the crowd it walked into. Read *after* the socket is up and its
 * frames are being buffered: the other order drops anybody who joins between the
 * response and the subscription, and nothing would ever mention them again.
 *
 * No retry loop, unlike `fetchEvent`: this runs per device, thousands of times,
 * against an API the run has already reached once. A miss costs one device a
 * stale roster until it reconnects, which is cheaper than thousands of clients
 * hammering an API that is having a bad second.
 */
export async function fetchParticipants(apiUrl: string, eventId: string): Promise<Participant[]> {
  const response = await fetch(new URL(`/events/${eventId}/participants`, apiUrl))

  if (!response.ok) {
    throw new Error(`The API answered ${response.status} for the participants of ${eventId}.`)
  }

  const body = z
    .object({ participants: z.array(participantSchema) })
    .safeParse(await response.json())

  if (!body.success) {
    throw new Error(`The API answered with a roster this simulator cannot read: ${body.error}`)
  }

  return body.data.participants
}

/**
 * Node buries the useful half of a failed fetch: the thrown message is always
 * "fetch failed", the reason hangs off `cause`, and when a host resolves to
 * both an IPv6 and an IPv4 address that reason is an `AggregateError` whose own
 * message is empty — one attempt per address, each with the code that matters.
 */
function describe(error: unknown): string {
  if (error instanceof AggregateError) {
    const reasons = new Set(error.errors.map(inner => describe(inner)))
    return [...reasons].join(', ')
  }

  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code
    const address = (error as { address?: string; port?: number }).address
    const where = address ? ` at ${address}:${(error as { port?: number }).port}` : ''

    if (code) return `${code}${where}`
    if (error.cause) return describe(error.cause)

    return error.message || error.name
  }

  return String(error)
}

/** Where a device connects, derived from the same helper every client uses. */
export function joinSocketUrl(apiUrl: string, eventId: string) {
  const url = new URL(socketPaths.join(eventId), apiUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

  return url.toString()
}
