import type { CreateEvent, EventGraph, EventWire, Participant, User } from '@pollo/contracts'
import { env } from '$env/dynamic/public'

/** Every failure the API can answer with, as one throwable. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function apiBaseUrl(): string {
  return env.PUBLIC_POLLO_API_URL ?? 'http://localhost:3333'
}

/** Same origin as the REST API, upgraded — `http(s)` maps to `ws(s)`. */
export function apiSocketUrl(path: string): string {
  const url = new URL(path, apiBaseUrl())
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

interface ApiClientOptions {
  /** SvelteKit's `fetch` inside load functions; the global one elsewhere. */
  fetch?: typeof globalThis.fetch
  /** JWT from the session cookie. Anonymous when absent. */
  token?: string | null
  /**
   * Where to reach the API. Defaults to the public address, which is the only
   * one a browser can use; server-side callers pass the internal one, since
   * inside a compose network the public host does not resolve.
   */
  baseUrl?: string
}

export function createApiClient({
  fetch = globalThis.fetch,
  token,
  baseUrl = apiBaseUrl(),
}: ApiClientOptions = {}) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)

    if (token) headers.set('authorization', `Bearer ${token}`)
    if (init.body) headers.set('content-type', 'application/json')

    let response: Response

    try {
      response = await fetch(new URL(path, baseUrl), { ...init, headers })
    } catch (cause) {
      // A dead API is indistinguishable from no network here, and both mean
      // the same thing to the operator: the panel cannot reach Pollo.
      throw new ApiError(0, 'Could not reach the Pollo API.', cause)
    }

    if (response.status === 204) return undefined as T

    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      const { message, issues } = (payload ?? {}) as { message?: string; issues?: unknown }
      throw new ApiError(
        response.status,
        message ?? `Request failed with ${response.status}.`,
        issues,
      )
    }

    return payload as T
  }

  return {
    getProfile: () => request<{ user: User }>('/profile').then(({ user }) => user),

    listMyEvents: () => request<{ events: EventWire[] }>('/events').then(({ events }) => events),

    createEvent: (input: CreateEvent) =>
      request<{ eventId: string }>('/events', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then(({ eventId }) => eventId),

    getEvent: (eventId: string) =>
      request<{ event: EventWire }>(`/events/${eventId}`).then(({ event }) => event),

    getParticipants: (eventId: string) =>
      request<{ participants: Participant[] }>(`/events/${eventId}/participants`).then(
        ({ participants }) => participants,
      ),

    getEventGraph: (eventId: string) => request<EventGraph>(`/events/${eventId}/graph`),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
