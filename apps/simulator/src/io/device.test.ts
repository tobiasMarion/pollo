import type { Effect } from '@pollo/contracts'
import { projectLocation } from '@pollo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Seat } from '../crowd/seat.js'
import { type ErrorBudget, SharedErrorField } from '../noise/gnss.js'
import { Random } from '../noise/random.js'
import {
  attach,
  COUNTER,
  createSharedBuffers,
  DEVICE,
  read,
  SETTING,
  write,
} from '../run/shared.js'
import { parseConfig, type SimulatorConfig } from './config.js'
import { type DeviceContext, VirtualDevice } from './device.js'
import type { Transport, TransportHandlers } from './transport.js'

const EVENT = '00000000-0000-4000-8000-000000000000'
const ORIGIN = { latitude: -30.03, longitude: -51.23 }

/** Small enough that a reported location is its true one, to a centimetre. */
const EXACT: ErrorBudget = { horizontal: 0.0001, vertical: 0.0001 }

const NOTHING_HAPPENS = { churn: 0, blackout: 0, move: 0 }

/** A socket the test holds both ends of. */
class FakeSocket implements Transport {
  readonly sent: unknown[] = []
  private open = false
  private done = false

  constructor(
    readonly url: string,
    private readonly handlers: TransportHandlers,
  ) {}

  send(payload: string) {
    if (!this.open || this.done) return false

    this.sent.push(JSON.parse(payload))
    return true
  }

  close() {
    if (this.done) return

    this.done = true
    this.open = false
    this.handlers.close()
  }

  /** The API accepted the connection. */
  accept() {
    this.open = true
    this.handlers.open()
  }

  /** The API hung up on us. */
  hangUp() {
    this.close()
  }

  deliver(message: unknown) {
    this.handlers.message(JSON.stringify(message))
  }

  sentOfType(type: string) {
    return this.sent.filter(message => (message as { type: string }).type === type)
  }

  get closed() {
    return this.done
  }
}

function harness(flags: string[] = [], budget: ErrorBudget = EXACT) {
  const parsed = parseConfig(['--event', EVENT, '--seed', '7', ...flags])

  if (parsed.help) throw new Error('unreachable')

  const config: SimulatorConfig = parsed.config
  const shared = attach(createSharedBuffers(config.clients), config.clients)

  // What the pool does at startup: a zeroed buffer would mean a run that begins
  // with every sensor telling the truth.
  write(shared.settings, SETTING.NOISE, 1)

  // A short row of people a metre apart: near enough to hear each other, far
  // enough not to be the same device.
  const seats: Seat[] = Array.from({ length: 6 }, (_, index) => ({
    point: { x: index, y: 0, z: 1.4 },
    level: 0,
  }))

  for (let peer = 1; peer < seats.length; peer++) {
    shared.truth[peer * 3] = (seats[peer] as Seat).point.x
    shared.truth[peer * 3 + 1] = 0
    shared.truth[peer * 3 + 2] = 1.4
  }

  const sockets: FakeSocket[] = []
  const effects: Effect[] = []

  const context: DeviceContext = {
    url: 'ws://localhost/join',
    origin: ORIGIN,
    config,
    shared,
    budget,
    seats,
    spareSeats: [4, 5],
    connect: (url, handlers) => {
      const socket = new FakeSocket(url, handlers)
      sockets.push(socket)

      return socket
    },
    onEffect: effect => effects.push(effect),
  }

  const field = new SharedErrorField(new Random(1))
  const device = new VirtualDevice(0, 0, 0, new Random(config.seed), context)

  let clock = 1_000

  return {
    device,
    shared,
    sockets,
    effects,
    latest: () => sockets[sockets.length - 1] as FakeSocket,
    /** The server telling this device what to range against. */
    assign: (peers: number[]) => {
      ;(sockets[sockets.length - 1] as FakeSocket).deliver({
        type: 'SET_NEIGHBORS',
        peers: peers.map(peer => `sim-${peer}`),
      })
    },
    accept: () => {
      ;(sockets[sockets.length - 1] as FakeSocket).accept()
    },
    at: () => clock,
    /** Runs the device forward, ticking every 50 ms as a shard does. */
    advance(seconds: number, chance = NOTHING_HAPPENS) {
      const until = clock + seconds * 1_000

      while (clock < until) {
        clock += 50
        vi.setSystemTime(clock)
        field.advanceTo(Math.floor(clock / 250))
        device.tick(clock, field, chance)
      }
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('VirtualDevice', () => {
  it('opens a socket and joins with where it thinks it is', async () => {
    const run = harness()

    run.advance(0.1)
    expect(run.sockets.length).toBe(1)

    run.accept()

    const [join] = run.latest().sentOfType('JOIN') as [{ deviceId: string; location: never }]

    expect(join.deviceId).toBe('sim-0')

    const where = projectLocation(join.location, ORIGIN)

    // Not exact even with a perfect fix: nobody stands perfectly still.
    expect(Math.hypot(where.x, where.y)).toBeLessThan(0.5)
    expect(where.z).toBeCloseTo(1.4, 1)
  })

  it('reports its location at the rate it was given', async () => {
    const run = harness(['--report-hz', '2', '--distance-hz', '0.01'])

    run.advance(0.1)
    run.accept()
    run.advance(10)

    const updates = run.latest().sentOfType('LOCATION_UPDATE').length

    // Ten seconds at 2 Hz, less the staggered first report.
    expect(updates).toBeGreaterThanOrEqual(18)
    expect(updates).toBeLessThanOrEqual(21)
  })

  it('lies about where it is, by about as much as the venue says', async () => {
    const run = harness(['--report-hz', '4', '--distance-hz', '0.01', '--common-mode', '0'], {
      horizontal: 6,
      vertical: 12,
    })

    run.advance(0.1)
    run.accept()
    run.advance(200)

    const errors = run
      .latest()
      .sentOfType('LOCATION_UPDATE')
      .map(message => {
        const { location } = message as { location: Parameters<typeof projectLocation>[0] }
        const where = projectLocation(location, ORIGIN)

        return Math.hypot(where.x, where.y)
      })

    const worst = Math.max(...errors)

    expect(worst).toBeGreaterThan(1)
    expect(worst).toBeLessThan(60)
  })

  it('ranges exactly the peers it was assigned', () => {
    const run = harness(['--distance-hz', '2', '--report-hz', '0.01'])

    run.advance(0.1)
    run.accept()
    run.assign([1, 2, 3])
    run.advance(0.6)

    const sweep = run.latest().sentOfType('DISTANCE')

    expect(sweep.length).toBeGreaterThan(0)
    expect(sweep.length).toBeLessThanOrEqual(3)
  })

  it('measures a peer as being about as far away as it is', () => {
    const run = harness(['--distance-hz', '2', '--report-hz', '0.01'])

    run.advance(0.1)
    run.accept()
    run.assign([1, 2, 3, 4, 5])
    run.advance(30)

    const measured = run.latest().sentOfType('DISTANCE') as { to: string; distance: number }[]
    const toFirstPeer = measured.filter(edge => edge.to === 'sim-1' && edge.distance !== null)

    expect(toFirstPeer.length).toBeGreaterThan(0)

    for (const edge of toFirstPeer) expect(edge.distance).toBeGreaterThan(0)

    const average = toFirstPeer.reduce((sum, edge) => sum + edge.distance, 0) / toFirstPeer.length

    // The peer is one metre away, and the measurement is allowed to disagree.
    expect(average).toBeGreaterThan(0.6)
    expect(average).toBeLessThan(1.5)
  })

  /** Who a sweep actually reached, by peer id. */
  function measured(socket: { sentOfType(type: string): unknown[] }) {
    return new Set(
      (socket.sentOfType('DISTANCE') as { to: string; distance: number | null }[])
        .filter(edge => edge.distance !== null)
        .map(edge => edge.to),
    )
  }

  it('measures nobody until the server says who', () => {
    const run = harness(['--distance-hz', '2', '--report-hz', '0.01'])

    // Every one of them is a metre away and perfectly audible. What the phone
    // does not have is anything telling it they exist — with UWB that message
    // is what carries the discovery token, and without it there is nothing to
    // range against at all.
    run.advance(0.1)
    run.accept()
    run.advance(5)

    expect(run.latest().sentOfType('DISTANCE')).toEqual([])
  })

  it('starts measuring a peer the moment it is assigned one', () => {
    const run = harness(['--distance-hz', '2', '--report-hz', '0.01'])

    run.advance(0.1)
    run.accept()
    run.advance(2)

    expect(run.latest().sentOfType('DISTANCE')).toEqual([])

    run.assign([3])
    run.advance(2)

    expect([...measured(run.latest())]).toEqual(['sim-3'])
  })

  it('takes a new assignment as replacing the old one, and retracts the difference', () => {
    const run = harness(['--distance-hz', '2', '--report-hz', '0.01'])

    run.advance(0.1)
    run.accept()
    run.assign([1, 2])
    run.advance(3)

    expect(measured(run.latest()).has('sim-2')).toBe(true)

    run.assign([1])
    run.advance(3)

    // An edge nobody retracts is indistinguishable from one that is still true.
    const retraction = (
      run.latest().sentOfType('DISTANCE') as { to: string; distance: number | null }[]
    ).filter(edge => edge.to === 'sim-2' && edge.distance === null)

    expect(retraction.length).toBeGreaterThan(0)
  })

  it('says nothing about a peer the radio cannot reach', () => {
    const run = harness(['--distance-hz', '2', '--report-hz', '0.01', '--range', '2'])

    run.advance(0.1)
    run.accept()

    // The server picks from GPS, which is metres wrong, so some of what it
    // suggests is out of earshot. There is no edge to report and none to
    // retract, so the sweep simply passes over it.
    run.assign([1, 5])
    run.advance(3)

    expect([...measured(run.latest())]).toEqual(['sim-1'])
    expect(run.latest().sentOfType('DISTANCE')).not.toContainEqual(
      expect.objectContaining({ to: 'sim-5' }),
    )
  })

  it('waits to be told again after a blackout it came back from', () => {
    const run = harness(['--distance-hz', '2', '--report-hz', '0.01'])

    run.advance(0.1)
    run.accept()
    run.assign([1, 2])
    run.advance(2)

    run.advance(0.05, { churn: 0, blackout: 1, move: 0 })
    run.advance(31)
    run.accept()
    run.advance(3)

    // The list belonged to a socket that is gone, and the server owes this
    // device a fresh one on the socket that replaced it.
    expect(run.latest().sentOfType('DISTANCE')).toEqual([])

    run.assign([1, 2])
    run.advance(3)

    expect(measured(run.latest()).size).toBeGreaterThan(0)
  })

  it('hands a cue to the run rather than dropping it', async () => {
    const run = harness()

    run.advance(0.1)
    run.accept()

    const effect = {
      name: 'PULSE',
      coordinateType: 'RELATIVE',
      activeTime: 1,
      spreadDelayPerUnit: 0,
    }

    run.latest().deliver({ type: 'EFFECT', effect })

    expect(run.effects).toEqual([effect])
  })

  it('leaves the event, and stays away long enough for the API to notice', async () => {
    const run = harness()

    run.advance(0.1)
    run.accept()
    run.advance(0.1)

    run.advance(0.05, { churn: 1, blackout: 0, move: 0 })

    expect(run.latest().closed).toBe(true)
    expect(read(run.shared.counters, COUNTER.CONNECTED)).toBe(0)
    expect((run.shared.flags[0] ?? 0) & DEVICE.CONNECTED).toBe(0)

    // Nobody comes back within a few seconds of walking out.
    run.advance(15)
    expect(run.sockets.length).toBe(1)

    run.advance(170)
    expect(run.sockets.length).toBe(2)
  })

  it('loses signal, and is back within the minute', async () => {
    const run = harness()

    run.advance(0.1)
    run.accept()
    run.advance(0.1)

    run.advance(0.05, { churn: 0, blackout: 1, move: 0 })

    expect(run.latest().closed).toBe(true)
    expect(read(run.shared.counters, COUNTER.RECONNECTS)).toBe(1)

    run.advance(31)

    expect(run.sockets.length).toBe(2)

    run.accept()
    run.advance(0.1)

    expect(run.latest().sentOfType('JOIN').length).toBe(1)
    expect(read(run.shared.counters, COUNTER.CONNECTED)).toBe(1)
  })

  it('comes back after the API drops it, without being told to', async () => {
    const run = harness()

    run.advance(0.1)
    run.accept()
    run.advance(0.1)

    run.latest().hangUp()

    expect(read(run.shared.counters, COUNTER.RECONNECTS)).toBe(1)
    expect(read(run.shared.counters, COUNTER.CONNECTED)).toBe(0)

    run.advance(3)

    expect(run.sockets.length).toBe(2)
  })

  it('takes the position the worker sends it, and nothing else', async () => {
    const run = harness()

    run.advance(0.1)
    run.accept()

    const somewhere = { x: 0, y: 0, z: 0 }

    run.latest().deliver({
      type: 'SET_POINT',
      position: {
        uncorrected: { relative: somewhere, absolute: somewhere },
        simulated: { relative: { x: 3, y: 4, z: 5 }, absolute: somewhere },
      },
    })

    run.latest().deliver({ type: 'NONSENSE' })

    expect([...run.shared.estimate.slice(0, 3)]).toEqual([3, 4, 5])
    expect((run.shared.flags[0] ?? 0) & DEVICE.PLACED).toBe(DEVICE.PLACED)
    expect(read(run.shared.counters, COUNTER.SET_POINTS)).toBe(1)
    expect(read(run.shared.counters, COUNTER.RECEIVED)).toBe(2)
  })

  it('tells the exact truth once the noise is switched off', async () => {
    const run = harness(['--report-hz', '4', '--distance-hz', '4'], {
      horizontal: 20,
      vertical: 30,
    })

    run.advance(0.1)
    run.accept()
    run.assign([1, 2, 3])

    write(run.shared.settings, SETTING.NOISE, 0)
    run.advance(5)

    const clean = run.latest().sentOfType('LOCATION_UPDATE')
    expect(clean.length).toBeGreaterThan(0)

    for (const message of clean) {
      const { location } = message as { location: Parameters<typeof projectLocation>[0] }
      const where = projectLocation(location, ORIGIN)

      // The seat, plus the sway — which is where the device really is, and so
      // is the truth rather than an error.
      expect(Math.hypot(where.x, where.y)).toBeLessThan(0.6)
      expect(location.horizontalAccuracy).toBe(1)
    }

    const measured = run.latest().sentOfType('DISTANCE') as { to: string; distance: number }[]
    const toFirstPeer = measured.filter(edge => edge.to === 'sim-1' && edge.distance !== null)

    expect(toFirstPeer.length).toBeGreaterThan(0)
    for (const edge of toFirstPeer) expect(edge.distance).toBeCloseTo(1, 0)
  })

  it('starts lying again when the noise comes back', async () => {
    const run = harness(['--report-hz', '4', '--distance-hz', '0.01', '--common-mode', '0'], {
      horizontal: 20,
      vertical: 30,
    })

    run.advance(0.1)
    run.accept()
    run.assign([1, 2, 3])

    write(run.shared.settings, SETTING.NOISE, 0)
    run.advance(5)

    write(run.shared.settings, SETTING.NOISE, 1)
    run.advance(60)

    const errors = run
      .latest()
      .sentOfType('LOCATION_UPDATE')
      .map(message => {
        const { location } = message as { location: Parameters<typeof projectLocation>[0] }
        const where = projectLocation(location, ORIGIN)

        return Math.hypot(where.x, where.y)
      })

    expect(Math.max(...errors)).toBeGreaterThan(2)
  })

  it('drifts around its seat without ever leaving it', async () => {
    const run = harness(['--report-hz', '0.01', '--distance-hz', '0.01'])

    run.advance(0.1)
    run.accept()

    let moved = 0

    for (let i = 0; i < 20; i++) {
      run.advance(30)
      moved = Math.max(moved, Math.hypot(run.shared.truth[0] ?? 0, run.shared.truth[1] ?? 0))
    }

    expect(moved).toBeGreaterThan(0.02)
    expect(moved).toBeLessThan(1)
  })

  it('walks to another seat rather than teleporting into it', async () => {
    const run = harness(['--report-hz', '0.01', '--distance-hz', '0.01'])

    run.advance(0.1)
    run.accept()

    run.advance(0.05, { churn: 0, blackout: 0, move: 1 })
    run.advance(3)

    const midway = Math.hypot(run.shared.truth[0] ?? 0, run.shared.truth[1] ?? 0)

    run.advance(12)

    const arrived = Math.hypot(run.shared.truth[0] ?? 0, run.shared.truth[1] ?? 0)

    // Seats 4 and 5 are the spare ones, four and five metres away.
    expect(midway).toBeGreaterThan(0.5)
    expect(midway).toBeLessThan(arrived)
    expect(arrived).toBeGreaterThan(3.5)
  })
})
