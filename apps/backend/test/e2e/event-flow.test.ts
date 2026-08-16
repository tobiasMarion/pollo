import type { AddressInfo } from 'node:net'
import { type Message, messageSchema, STREAM_FIELD, streamKeys, WS_CLOSE } from '@pollo/contracts'
import { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createTestApp, createUser, truncateDatabase, waitFor } from '../helpers.js'
import { TEST_REDIS_URL } from '../test-env.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>

const location = {
  latitude: -29.6842,
  longitude: -53.8069,
  horizontalAccuracy: 5,
  altitude: 100,
  verticalAccuracy: 3,
}

const position = {
  uncorrected: { relative: { x: 0, y: 0, z: 0 }, absolute: { x: 1, y: 1, z: 1 } },
  simulated: { relative: { x: 0.5, y: 0.5, z: 0 }, absolute: { x: 1.5, y: 1.5, z: 1 } },
}

/** Buffers incoming messages so tests can await specific types in order. */
class WsClient {
  private readonly socket: WebSocket
  private readonly inbox: Message[] = []
  private readonly openPromise: Promise<void>

  constructor(url: string) {
    this.socket = new WebSocket(url)
    this.openPromise = new Promise((resolve, reject) => {
      this.socket.once('open', resolve)
      this.socket.once('error', reject)
    })
    this.socket.on('message', raw => {
      const parsed = messageSchema.safeParse(JSON.parse(raw.toString()))
      if (parsed.success) this.inbox.push(parsed.data)
    })
  }

  async ready() {
    await this.openPromise
    return this
  }

  send(message: unknown) {
    this.socket.send(JSON.stringify(message))
  }

  async next<T extends Message['type']>(type: T) {
    return (await waitFor(
      () => this.inbox.find(message => message.type === type),
      found => found !== undefined,
    )) as Extract<Message, { type: T }>
  }

  received(type: Message['type']) {
    return this.inbox.filter(message => message.type === type)
  }

  /**
   * The admin panel is sent coalesced batches rather than a frame per event, so
   * an assertion has to wait for the batch that carries what it is looking for
   * rather than for the next one to arrive.
   */
  async batchWith(carries: (update: Extract<Message, { type: 'FIELD_UPDATE' }>) => boolean) {
    return (await waitFor(
      () =>
        this.inbox.find(
          (message): message is Extract<Message, { type: 'FIELD_UPDATE' }> =>
            message.type === 'FIELD_UPDATE' && carries(message),
        ),
      found => found !== undefined,
    )) as Extract<Message, { type: 'FIELD_UPDATE' }>
  }

  close() {
    this.socket.close()
  }

  get closed() {
    return new Promise<void>(resolve => {
      if (this.socket.readyState === WebSocket.CLOSED) return resolve()
      this.socket.once('close', () => resolve())
    })
  }
}

describe('event lifecycle end to end', () => {
  let app: TestApp
  let redis: Redis
  let baseUrl: string
  let wsUrl: string
  let token: string

  beforeAll(async () => {
    app = await createTestApp()
    await truncateDatabase(app)

    redis = new Redis(TEST_REDIS_URL)
    await redis.flushdb()

    await app.listen({ host: '127.0.0.1', port: 0 })
    const { port } = app.server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}`
    wsUrl = `ws://127.0.0.1:${port}`

    ;({ token } = await createUser(app, 'e2e-admin@test.dev'))
  })

  afterAll(async () => {
    await truncateDatabase(app)
    await redis.quit()
    await app.close()
  })

  it('runs the full flow: create, admin auth, join, distances, worker positions', async () => {
    const createResponse = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'E2E Night', ...location, type: 'SCREEN' }),
    })
    expect(createResponse.status).toBe(201)
    const { eventId } = (await createResponse.json()) as { eventId: string }

    const controlEntries = await redis.xrange(streamKeys.control(), '-', '+')
    const controlOps = controlEntries.map(([, fields]) => {
      const data = fields[fields.indexOf(STREAM_FIELD) + 1]
      return JSON.parse(data ?? '{}').op
    })
    expect(controlOps).toContain('EVENT_OPENED')

    const admin = await new WsClient(`${wsUrl}/events/${eventId}/admin`).ready()
    admin.send({ type: 'AUTHENTICATION', token })
    await admin.next('AUTHENTICATION_ACK')

    const subscriber = await new WsClient(`${wsUrl}/events/${eventId}/join`).ready()
    subscriber.send({ type: 'JOIN', deviceId: 'device-1', location })

    subscriber.send({ type: 'DISTANCES', measurements: [{ to: 'device-2', distance: 3.2 }] })

    const arrival = await admin.batchWith(
      update => update.locations.length > 0 && update.edges.length > 0,
    )
    expect(arrival.locations).toEqual([{ deviceId: 'device-1', location }])
    expect(arrival.edges).toEqual([{ from: 'device-1', to: 'device-2', distance: 3.2 }])
    expect(arrival.window).toBeGreaterThan(0)

    // One entry per window, carrying the ops of that window — not one entry per
    // mutation, which was an XADD for every message the crowd sent.
    const ingestOps = await waitFor(
      async () => {
        const entries = await redis.xrange(streamKeys.ingest(eventId), '-', '+')

        return entries.flatMap(([, fields]) => {
          const data = fields[fields.indexOf(STREAM_FIELD) + 1]

          return (JSON.parse(data ?? '{}').ops ?? []) as Array<{ op: string }>
        })
      },
      ops => ops.length >= 2,
    )

    expect(ingestOps.map(({ op }) => op)).toEqual(['JOIN', 'DISTANCE'])

    // Simulated Rust worker: writes a positions delta for the subscriber.
    await redis.xadd(
      streamKeys.positions(eventId),
      '*',
      STREAM_FIELD,
      JSON.stringify({ kind: 'delta', points: [{ deviceId: 'device-1', position }] }),
    )

    const setPoint = await subscriber.next('SET_POINT')
    expect(setPoint.position).toEqual(position)

    const placement = await admin.batchWith(update => update.placed.length > 0)
    expect(placement.placed).toEqual([{ deviceId: 'device-1', position }])

    const participantsResponse = await fetch(`${baseUrl}/events/${eventId}/participants`)
    const { participants } = (await participantsResponse.json()) as {
      participants: Array<{ deviceId: string }>
    }
    expect(participants.map(p => p.deviceId)).toEqual(['device-1'])

    subscriber.close()
    await subscriber.closed

    const departure = await admin.batchWith(update => update.left.length > 0)
    expect(departure.left).toEqual(['device-1'])

    admin.close()
    await admin.closed
  })

  it('rejects a join to an unknown event with the NOT_FOUND close code', async () => {
    const socket = new WebSocket(`${wsUrl}/events/00000000-0000-4000-8000-000000000000/join`)

    const code = await new Promise<number>(resolve => {
      socket.on('close', closeCode => resolve(closeCode))
    })

    expect(code).toBe(4404)
  })

  it('closes the admin socket of a non-admin with the UNAUTHORIZED close code', async () => {
    const createResponse = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'E2E Night 2', ...location, type: 'SCREEN' }),
    })
    const { eventId } = (await createResponse.json()) as { eventId: string }

    const { token: strangerToken } = await createUser(app, 'e2e-stranger@test.dev')

    const socket = new WebSocket(`${wsUrl}/events/${eventId}/admin`)
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'AUTHENTICATION', token: strangerToken }))
    })

    const code = await new Promise<number>(resolve => {
      socket.on('close', closeCode => resolve(closeCode))
    })

    expect(code).toBe(4401)
  })

  it('closes the admin socket on a frame that belongs to the device direction', async () => {
    const createResponse = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'E2E Night 3', ...location, type: 'SCREEN' }),
    })
    const { eventId } = (await createResponse.json()) as { eventId: string }

    const socket = new WebSocket(`${wsUrl}/events/${eventId}/admin`)
    socket.on('open', () => {
      // A well-formed JOIN — valid on the device socket, meaningless here.
      socket.send(JSON.stringify({ type: 'JOIN', deviceId: 'device-1', location }))
    })

    const code = await new Promise<number>(resolve => {
      socket.on('close', closeCode => resolve(closeCode))
    })

    expect(code).toBe(WS_CLOSE.INVALID_MESSAGE)
  })
})
