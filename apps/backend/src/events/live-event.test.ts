import { randomUUID } from 'node:crypto'
import type { ControlMessage, IngestMessage, Location, Message } from '@pollo/contracts'
import type { Redis } from 'ioredis'
import RedisMock from 'ioredis-mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveEvent } from './live-event.js'
import type { Bus } from './redis/bus.js'
import { GraphStore } from './redis/graph-store.js'

const location: Location = {
  latitude: -29.7,
  longitude: -53.7,
  horizontalAccuracy: 5,
  altitude: 100,
  verticalAccuracy: 3,
}

const position = {
  uncorrected: { relative: { x: 0, y: 0, z: 0 }, absolute: { x: 1, y: 1, z: 1 } },
  simulated: { relative: { x: 0, y: 0, z: 0 }, absolute: { x: 1, y: 1, z: 1 } },
}

class FakeBus implements Bus {
  ingest: Array<{ eventId: string; message: IngestMessage }> = []
  control: ControlMessage[] = []

  publishIngest(eventId: string, message: IngestMessage) {
    this.ingest.push({ eventId, message })
  }

  publishControl(message: ControlMessage) {
    this.control.push(message)
  }

  subscribePositions() {
    return { stop: vi.fn() }
  }
}

describe('LiveEvent', () => {
  let bus: FakeBus
  let service: LiveEvent
  let adminInbox: Message[]

  beforeEach(() => {
    bus = new FakeBus()
    adminInbox = []
    // ioredis-mock instances share one keyspace; a unique graph id isolates tests.
    const eventId = randomUUID()
    service = new LiveEvent({
      id: eventId,
      location: { latitude: -29.7, longitude: -53.7 },
      adminId: 'admin-1',
      graphStore: new GraphStore(new RedisMock() as unknown as Redis, eventId),
      bus,
    })
    service.setAdminConnection(message => adminInbox.push(message))
  })

  /** The one batch the admin was sent, as the typed frame it is. */
  function batch() {
    expect(adminInbox).toHaveLength(1)

    const update = adminInbox[0]
    if (update?.type !== 'FIELD_UPDATE') throw new Error(`expected a batch, got ${update?.type}`)

    adminInbox.length = 0

    return update
  }

  it('subscribe fans out USER_JOINED and publishes a JOIN ingest', async () => {
    const firstInbox: Message[] = []
    service.subscribe({ deviceId: 'd1', location, sendMessage: m => firstInbox.push(m) })

    const secondInbox: Message[] = []
    service.subscribe({ deviceId: 'd2', location, sendMessage: m => secondInbox.push(m) })

    await service.settled()

    // The admin hears about arrivals in the batch, not one frame each.
    expect(adminInbox).toEqual([])
    service.flushDigest()
    expect(batch().locations).toEqual([
      { deviceId: 'd1', location },
      { deviceId: 'd2', location },
    ])

    expect(firstInbox).toContainEqual({ type: 'USER_JOINED', deviceId: 'd2', location })
    expect(bus.ingest.map(({ message }) => message.op)).toEqual(['JOIN', 'JOIN'])

    expect(service.getSubscribers()).toContainEqual({ deviceId: 'd1', location })
  })

  /**
   * The roster a joining device reads has to be current the moment it asks. Read
   * from the graph store this would still be empty here, because those writes are
   * queued off the hot path — and `USER_JOINED` only covers arrivals after this
   * point, so anybody missing from the snapshot is missing for good.
   */
  it('getSubscribers is current without waiting for the store', () => {
    service.subscribe({ deviceId: 'd1', location, sendMessage: () => {} })

    expect(service.getSubscribers()).toEqual([{ deviceId: 'd1', location }])
  })

  it('getSubscribers carries the latest location a device reported', () => {
    const moved: Location = { ...location, latitude: -29.8 }

    service.subscribe({ deviceId: 'd1', location, sendMessage: () => {} })
    service.updateSubscriberLocation('d1', moved)

    expect(service.getSubscribers()).toEqual([{ deviceId: 'd1', location: moved }])
  })

  /**
   * The worker runs in another process off a snapshot, so it is always a little
   * behind the connection map and will publish a position for somebody who just
   * disconnected. The panel upserts on `placed`, so letting one through recreates
   * a device it was told to forget — and a killed simulation never clears.
   */
  it('drops a position for a device that has already left', async () => {
    service.subscribe({ deviceId: 'd1', location, sendMessage: () => {} })
    service.unsubscribe('d1')

    service.flushDigest()
    expect(batch().left).toEqual(['d1'])

    service.broadcastPositions({ kind: 'delta', points: [{ deviceId: 'd1', position }] })

    // Nothing at all, rather than a batch that puts it back on the field.
    expect(service.flushDigest()).toBeUndefined()
    expect(adminInbox).toEqual([])
  })

  it('setDistanceToDevice reports to the admin and publishes DISTANCE', async () => {
    service.subscribe({ deviceId: 'd1', location, sendMessage: () => {} })

    service.setDistanceToDevice('d1', 'd2', 4.2)
    service.setDistanceToDevice('d1', 'd2', null)

    await service.settled()

    // Two changes to one edge inside a window are one entry: the later value.
    service.flushDigest()
    expect(batch().edges).toEqual([{ from: 'd1', to: 'd2', distance: null }])
    expect(bus.ingest.map(({ message }) => message).slice(1)).toEqual([
      { op: 'DISTANCE', from: 'd1', to: 'd2', distance: 4.2 },
      { op: 'DISTANCE', from: 'd1', to: 'd2', distance: null },
    ])

    expect((await service.getEventGraph()).edges).toEqual([])
  })

  it('ignores location updates from unknown devices', () => {
    service.updateSubscriberLocation('ghost', location)

    expect(adminInbox).toEqual([])
    expect(bus.ingest).toEqual([])
  })

  it('unsubscribe publishes USER_LEFT and LEAVE, and forgets the device', async () => {
    const inbox: Message[] = []
    service.subscribe({ deviceId: 'd1', location, sendMessage: m => inbox.push(m) })

    service.unsubscribe('d1')
    service.unsubscribe('d1')

    await service.settled()

    service.flushDigest()
    const update = batch()
    expect(update.left).toEqual(['d1'])
    // Joining and leaving inside one window leaves the panel nothing to undo.
    expect(update.locations).toEqual([])
    expect(bus.ingest.map(({ message }) => message.op)).toEqual(['JOIN', 'LEAVE'])
    expect(service.getSubscribers()).toEqual([])
  })

  it('broadcastPositions routes SET_POINT to the right device and reports to the admin', () => {
    const first: Message[] = []
    const second: Message[] = []
    service.subscribe({ deviceId: 'd1', location, sendMessage: m => first.push(m) })
    service.subscribe({ deviceId: 'd2', location, sendMessage: m => second.push(m) })

    service.broadcastPositions({ kind: 'delta', points: [{ deviceId: 'd1', position }] })

    expect(first).toContainEqual({ type: 'SET_POINT', position })
    expect(second.filter(m => m.type === 'SET_POINT')).toEqual([])
    service.flushDigest()
    expect(batch().placed).toEqual([{ deviceId: 'd1', position }])
  })

  it('clearAdminConnection stops admin notifications', () => {
    service.clearAdminConnection()
    service.setDistanceToDevice('d1', 'd2', 1)
    service.flushDigest()

    expect(adminInbox).toEqual([])
  })

  it('says nothing at all when the field did not change', () => {
    service.flushDigest()
    service.flushDigest()

    expect(adminInbox).toEqual([])
  })

  it('never leaves an edge behind for a device that left in the same batch', () => {
    service.subscribe({ deviceId: 'd1', location, sendMessage: () => {} })
    service.subscribe({ deviceId: 'd2', location, sendMessage: () => {} })

    service.setDistanceToDevice('d1', 'd2', 4.2)
    service.unsubscribe('d1')

    service.flushDigest()
    const update = batch()

    // Whoever applies the departure first would drop an edge that has not
    // arrived yet, then add it — and nothing later retracts it, because the
    // server has already said all it has to say about that pair.
    expect(update.left).toEqual(['d1'])
    expect(update.edges).toEqual([])
  })

  it('ignores a distance from a device that has already gone', async () => {
    service.subscribe({ deviceId: 'd1', location, sendMessage: () => {} })
    service.unsubscribe('d1')

    // A socket that dies with frames still queued gets its DISTANCE handled
    // after its close. Writing the edge here resurrects the node that was just
    // removed, and nothing ever cleans it again.
    service.setDistanceToDevice('d1', 'd2', 7)

    await service.settled()
    service.flushDigest()

    expect(batch().edges).toEqual([])
    expect((await service.getEventGraph()).edges).toEqual([])
    expect(service.getSubscribers()).toEqual([])
  })

  it('ignores a distance from a device that never joined', () => {
    service.setDistanceToDevice('ghost', 'd2', 3)
    service.flushDigest()

    expect(adminInbox).toEqual([])
    expect(bus.ingest).toEqual([])
  })

  it('collapses a burst from one device into its latest reading', () => {
    service.subscribe({ deviceId: 'd1', location, sendMessage: () => {} })

    for (let i = 1; i <= 50; i++) {
      service.updateSubscriberLocation('d1', { ...location, altitude: 100 + i })
    }

    service.flushDigest()

    expect(batch().locations).toEqual([
      { deviceId: 'd1', location: { ...location, altitude: 150 } },
    ])
  })

  describe('clearStaleGraph', () => {
    it('throws away a graph left behind by sockets this runtime never had', async () => {
      service.subscribe({ deviceId: 'd1', location, sendMessage: () => {} })
      service.subscribe({ deviceId: 'd2', location, sendMessage: () => {} })
      service.setDistanceToDevice('d1', 'd2', 3)
      await service.settled()

      expect((await service.getEventGraph()).nodes).not.toEqual({})

      // What a restart leaves: the store still full, and nobody connected.
      service.unsubscribe('d1')
      service.unsubscribe('d2')
      await service.settled()

      await service.clearStaleGraph()

      const graph = await service.getEventGraph()

      expect(graph.nodes).toEqual({})
      expect(graph.edges).toEqual([])
    })

    it('goes ahead anyway when the event itself is ending', async () => {
      service.subscribe({ deviceId: 'd1', location, sendMessage: () => {} })
      await service.settled()

      // Closing an event with a crowd still in it is how events normally end.
      await service.discardGraph()

      expect((await service.getEventGraph()).nodes).toEqual({})
    })

    it('refuses while anybody is still connected', async () => {
      service.subscribe({ deviceId: 'd1', location, sendMessage: () => {} })
      await service.settled()

      await expect(service.clearStaleGraph()).rejects.toThrow(/live subscribers/)

      expect((await service.getEventGraph()).nodes).not.toEqual({})
    })
  })
})
