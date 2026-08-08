import {
  deviceInbound,
  type Origin,
  safeParseJsonMessage,
  unprojectLocation,
  type Vector3,
} from '@pollo/contracts'
import type { Seat } from '../crowd/seat.js'
import { DeviceGnss, type ErrorBudget, type SharedErrorField } from '../noise/gnss.js'
import type { Random } from '../noise/random.js'
import { Ranging } from '../noise/ranging.js'
import { Sway } from '../noise/sway.js'
import { bump, COUNTER, DEVICE, type SharedState, writeVector } from '../run/shared.js'
import type { SimulatorConfig } from './config.js'
import type { Connect, Transport } from './transport.js'

/** How long somebody takes to walk from one seat to another. */
const WALK_SECONDS = 12

/** How long somebody who left the event stays away before coming back. */
const AWAY_SECONDS = { min: 20, max: 180 }

/** How long a network blackout lasts. Mean of an exponential, then bounded. */
const BLACKOUT_SECONDS = { mean: 4, min: 1, max: 30 }

/** Reconnect delay after an unexpected close, so a dead API is not hammered. */
const RECONNECT_DELAY_MS = 2_000

export function deviceIdFor(index: number) {
  return `sim-${index}`
}

export interface DeviceContext {
  url: string
  origin: Origin
  config: SimulatorConfig
  shared: SharedState
  /** How wrong a fix is in this venue. */
  budget: ErrorBudget
  seats: readonly Seat[]
  /** Seats this shard may move its devices into. Owned, so no locking. */
  spareSeats: number[]
  neighborsOf: (index: number, into: number[]) => number[]
  connect: Connect
}

/**
 * What the device is doing. Three of these are offline for different reasons,
 * and the difference matters: somebody who left has to be seen leaving, while a
 * phone whose signal dropped is coming straight back.
 */
type Phase = 'waiting' | 'connecting' | 'online' | 'away' | 'blacked-out'

/**
 * One emulated phone. It owns no timer — the shard ticks everyone on one clock,
 * because twenty thousand intervals is a scheduler benchmark rather than a
 * crowd.
 */
export class VirtualDevice {
  readonly deviceId: string

  private phase: Phase = 'waiting'
  private socket: Transport | null = null

  private seatIndex: number
  private readonly gnss: DeviceGnss
  private readonly sway: Sway
  private readonly ranging: Ranging

  private dueAt: number
  private nextReportAt = 0
  private nextDistanceAt = 0
  private lastTickAt = 0
  private lastReportAt = 0

  /** Set while walking: where from, where to, and when it ends. */
  private walk: { from: Vector3; to: Vector3; startedAt: number; endsAt: number } | null = null

  /** Peers this device has told the server about, so it can retract them. */
  private readonly reportedPeers = new Set<number>()
  private readonly candidates: number[] = []

  constructor(
    readonly index: number,
    seatIndex: number,
    connectAt: number,
    private readonly random: Random,
    private readonly context: DeviceContext,
  ) {
    this.deviceId = deviceIdFor(index)
    this.seatIndex = seatIndex
    this.dueAt = connectAt

    this.gnss = new DeviceGnss(context.budget, random, context.config['common-mode'])
    this.sway = new Sway(random)
    this.ranging = new Ranging(random, context.config.range)

    writeVector(context.shared.truth, index, this.truePosition(0))
  }

  private seat() {
    return this.context.seats[this.seatIndex] as Seat
  }

  /** Where the phone really is: its seat, or a point along a walk, plus the sway. */
  private truePosition(now: number): Vector3 {
    const sway = this.sway.value
    const seat = this.seat().point

    if (!this.walk) {
      return { x: seat.x + sway.x, y: seat.y + sway.y, z: seat.z + sway.z }
    }

    const span = this.walk.endsAt - this.walk.startedAt
    const progress = span <= 0 ? 1 : Math.min(1, (now - this.walk.startedAt) / span)

    return {
      x: this.walk.from.x + (this.walk.to.x - this.walk.from.x) * progress + sway.x,
      y: this.walk.from.y + (this.walk.to.y - this.walk.from.y) * progress + sway.y,
      z: this.walk.from.z + (this.walk.to.z - this.walk.from.z) * progress + sway.z,
    }
  }

  private locationAt(now: number, field: SharedErrorField, dt: number) {
    const truth = this.truePosition(now)
    const reading = this.gnss.sample(field, dt)

    const noisy = {
      x: truth.x + reading.offset.x,
      y: truth.y + reading.offset.y,
      z: truth.z + reading.offset.z,
    }

    const { shared } = this.context

    writeVector(shared.reported, this.index, noisy)
    shared.flags[this.index] = (shared.flags[this.index] ?? 0) | DEVICE.REPORTED

    return unprojectLocation(noisy, this.context.origin, {
      horizontalAccuracy: reading.horizontalAccuracy,
      verticalAccuracy: reading.verticalAccuracy,
    })
  }

  private send(payload: unknown) {
    if (this.socket?.send(JSON.stringify(payload))) {
      bump(this.context.shared.counters, COUNTER.SENT)
    }
  }

  private connect(field: SharedErrorField) {
    this.phase = 'connecting'

    this.socket = this.context.connect(this.context.url, {
      open: () => this.opened(field),
      message: raw => this.receive(raw),
      error: () => bump(this.context.shared.counters, COUNTER.ERRORS),
      close: () => this.closed(),
    })
  }

  private opened(field: SharedErrorField) {
    this.phase = 'online'

    const { shared, config } = this.context
    shared.flags[this.index] = (shared.flags[this.index] ?? 0) | DEVICE.CONNECTED

    bump(shared.counters, COUNTER.CONNECTED)
    bump(shared.counters, COUNTER.JOINED)

    const now = Date.now()

    this.lastTickAt = now
    this.lastReportAt = now

    this.send({ type: 'JOIN', deviceId: this.deviceId, location: this.locationAt(now, field, 1) })

    // Staggered, or every device reports on the same millisecond and the run
    // measures a thundering herd rather than the API.
    this.nextReportAt = now + this.random.float() * (1_000 / config['report-hz'])
    this.nextDistanceAt = now + this.random.float() * (1_000 / config['distance-hz'])
  }

  private closed() {
    const wasOnline = this.phase === 'online'
    this.markOffline()

    // A departure and a blackout both closed the socket on purpose, and both
    // already know when they are coming back.
    if (this.phase === 'away' || this.phase === 'blacked-out') return

    if (wasOnline) bump(this.context.shared.counters, COUNTER.RECONNECTS)

    this.phase = 'waiting'
    this.dueAt = Date.now() + RECONNECT_DELAY_MS
  }

  private markOffline() {
    const { shared } = this.context

    if ((shared.flags[this.index] ?? 0) & DEVICE.CONNECTED) {
      bump(shared.counters, COUNTER.CONNECTED, -1)
    }

    shared.flags[this.index] = (shared.flags[this.index] ?? 0) & ~DEVICE.CONNECTED
    this.reportedPeers.clear()
    this.socket = null
  }

  private receive(raw: string) {
    const shared = this.context.shared
    bump(shared.counters, COUNTER.RECEIVED)

    const { success, data } = safeParseJsonMessage(raw, deviceInbound.schema)
    if (!success || data.type !== 'SET_POINT') return

    writeVector(shared.estimate, this.index, data.position.simulated.relative)
    shared.flags[this.index] = (shared.flags[this.index] ?? 0) | DEVICE.PLACED

    bump(shared.counters, COUNTER.SET_POINTS)
    bump(shared.counters, COUNTER.LATENCY_SUM_MS, Math.round(Date.now() - this.lastReportAt))
    bump(shared.counters, COUNTER.LATENCY_SAMPLES)
  }

  /** The person leaves for a while. The socket really closes: the API must see it go. */
  private leave(now: number) {
    // Set before closing: the close handler reads the phase to tell a departure
    // from a connection the API dropped, and only the latter comes straight back.
    this.phase = 'away'
    this.dueAt = now + this.random.between(AWAY_SECONDS.min, AWAY_SECONDS.max) * 1_000

    this.socket?.close()
    this.markOffline()
  }

  /**
   * The signal drops. Same as leaving as far as the API can tell, which is the
   * point: it cannot tell, and it has to behave the same either way. What
   * differs is how long — seconds, not minutes, and then the device is back
   * with the same id.
   */
  private blackout(now: number) {
    this.phase = 'blacked-out'

    const seconds = Math.min(
      BLACKOUT_SECONDS.max,
      Math.max(BLACKOUT_SECONDS.min, this.random.exponential(BLACKOUT_SECONDS.mean)),
    )

    this.dueAt = now + seconds * 1_000

    bump(this.context.shared.counters, COUNTER.RECONNECTS)

    this.socket?.close()
    this.markOffline()
  }

  /**
   * Interpolated rather than teleported: a jump would move every distance to
   * every neighbour in one sample, which no sensor produces and no worker
   * should have to explain.
   */
  private relocate(now: number) {
    const spare = this.context.spareSeats
    if (spare.length === 0) return

    const slot = this.random.below(spare.length)
    const target = spare[slot] as number

    spare[slot] = this.seatIndex

    const from = this.truePosition(now)
    this.seatIndex = target

    this.walk = { from, to: this.seat().point, startedAt: now, endsAt: now + WALK_SECONDS * 1_000 }
  }

  private sweepDistances(now: number) {
    const { config, neighborsOf, shared } = this.context
    const peers = neighborsOf(this.index, this.candidates)

    // A sample rather than everyone in earshot, so a dense venue does not
    // silently raise the message rate.
    const wanted = Math.min(config.neighbors, peers.length)

    for (let i = 0; i < wanted; i++) {
      const pick = i + this.random.below(peers.length - i)
      const swapped = peers[pick] as number

      peers[pick] = peers[i] as number
      peers[i] = swapped
    }

    const here = this.truePosition(now)
    const chosen = new Set<number>()

    for (let i = 0; i < wanted; i++) {
      const peer = peers[i] as number
      chosen.add(peer)

      const distance = Math.hypot(
        (shared.truth[peer * 3] ?? 0) - here.x,
        (shared.truth[peer * 3 + 1] ?? 0) - here.y,
        (shared.truth[peer * 3 + 2] ?? 0) - here.z,
      )

      const measured = this.ranging.measure(distance)

      if (measured !== null) {
        this.send({ type: 'DISTANCE', to: deviceIdFor(peer), distance: measured })
        this.reportedPeers.add(peer)
      } else if (this.reportedPeers.delete(peer)) {
        this.send({ type: 'DISTANCE', to: deviceIdFor(peer), distance: null })
      }
    }

    // Or the graph keeps an edge to somebody who walked away: an edge nobody
    // retracts is indistinguishable from one that is still true.
    for (const peer of this.reportedPeers) {
      if (chosen.has(peer)) continue

      this.send({ type: 'DISTANCE', to: deviceIdFor(peer), distance: null })
      this.reportedPeers.delete(peer)
    }
  }

  tick(now: number, field: SharedErrorField, perTickChance: PerTickChance) {
    if (this.phase !== 'online') {
      if (this.phase !== 'connecting' && now >= this.dueAt) this.connect(field)
      return
    }

    if (this.walk && now >= this.walk.endsAt) this.walk = null

    if (this.random.bool(perTickChance.churn)) return this.leave(now)
    if (this.random.bool(perTickChance.blackout)) return this.blackout(now)
    if (!this.walk && this.random.bool(perTickChance.move)) this.relocate(now)

    // Everyone shifts about where they stand, whether or not they are due to
    // report — the neighbours they are being measured against move too.
    this.sway.step(Math.max(0.001, (now - this.lastTickAt) / 1_000))
    this.lastTickAt = now

    writeVector(this.context.shared.truth, this.index, this.truePosition(now))

    if (now >= this.nextReportAt) {
      const dt = Math.max(0.001, (now - this.lastReportAt) / 1_000)

      this.nextReportAt = now + 1_000 / this.context.config['report-hz']
      this.lastReportAt = now

      this.send({ type: 'LOCATION_UPDATE', location: this.locationAt(now, field, dt) })
    }

    if (now >= this.nextDistanceAt) {
      this.nextDistanceAt = now + 1_000 / this.context.config['distance-hz']
      this.sweepDistances(now)
    }
  }

  stop() {
    this.phase = 'away'
    this.socket?.close()
    this.markOffline()
  }
}

export interface PerTickChance {
  churn: number
  blackout: number
  move: number
}

/** Rates arrive per minute and are applied per tick. */
export function perTickChance(config: SimulatorConfig, tickMs: number): PerTickChance {
  const ticksPerMinute = 60_000 / tickMs

  return {
    churn: config.churn / ticksPerMinute,
    blackout: config.blackout / ticksPerMinute,
    move: config['move-prob'] / ticksPerMinute,
  }
}
