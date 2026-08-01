import {
  deviceInbound,
  type Origin,
  safeParseJsonMessage,
  unprojectLocation,
  type Vector3,
} from '@pollo/contracts'
import WebSocket from 'ws'
import type { Seat } from '../crowd/bowl.js'
import type { Zone } from '../crowd/zones.js'
import { DeviceGnss, type SharedErrorField } from '../noise/gnss.js'
import type { Random } from '../noise/random.js'
import { Ranging } from '../noise/ranging.js'
import { bump, COUNTER, DEVICE, type SharedState, writeVector } from '../run/shared.js'
import type { SimulatorConfig } from './config.js'

/** How long a device takes to walk from one seat to another. */
const WALK_SECONDS = 12

/** How long a device that left stays away before coming back. */
const AWAY_SECONDS = { min: 20, max: 180 }

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
  zones: readonly Zone[]
  seats: readonly Seat[]
  /** Seats this shard may move its devices into. Owned, so no locking. */
  spareSeats: number[]
  neighborsOf: (index: number, into: number[]) => number[]
}

type Phase = 'waiting' | 'connecting' | 'online' | 'away'

/**
 * One emulated phone. It owns no timer — the shard ticks everyone on one clock.
 * See ./README.md#the-device.
 */
export class VirtualDevice {
  readonly deviceId: string

  private phase: Phase = 'waiting'
  private socket: WebSocket | null = null

  private seatIndex: number
  private gnss: DeviceGnss
  private readonly ranging: Ranging

  private dueAt: number
  private nextReportAt = 0
  private nextDistanceAt = 0

  /** Set while walking: where from, where to, and when it ends. */
  private walk: { from: Vector3; to: Vector3; startedAt: number; endsAt: number } | null = null

  /** Peers this device has told the server about, so it can retract them. */
  private readonly reportedPeers = new Set<number>()
  private readonly candidates: number[] = []

  private lastReportAt = 0

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

    this.gnss = new DeviceGnss(this.zone(), random, context.config['common-mode'])
    this.ranging = new Ranging(
      random,
      context.config.range,
      context.config['max-edge'] ?? context.config.range,
    )

    writeVector(context.shared.truth, index, this.truePosition(0))
  }

  private seat() {
    return this.context.seats[this.seatIndex] as Seat
  }

  private zone() {
    return this.context.zones[this.seat().zone] as Zone
  }

  /** Where the device actually is — its seat, or somewhere along a walk. */
  private truePosition(now: number): Vector3 {
    const seat = this.seat().point

    if (!this.walk) return seat

    const span = this.walk.endsAt - this.walk.startedAt
    const progress = span <= 0 ? 1 : Math.min(1, (now - this.walk.startedAt) / span)

    return {
      x: this.walk.from.x + (this.walk.to.x - this.walk.from.x) * progress,
      y: this.walk.from.y + (this.walk.to.y - this.walk.from.y) * progress,
      z: this.walk.from.z + (this.walk.to.z - this.walk.from.z) * progress,
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

    const { shared, index } = { shared: this.context.shared, index: this.index }

    writeVector(shared.truth, index, truth)
    writeVector(shared.reported, index, noisy)
    shared.flags[index] = (shared.flags[index] ?? 0) | DEVICE.REPORTED

    return unprojectLocation(noisy, this.context.origin, {
      horizontalAccuracy: reading.horizontalAccuracy,
      verticalAccuracy: reading.verticalAccuracy,
    })
  }

  private send(payload: unknown) {
    if (this.socket?.readyState !== WebSocket.OPEN) return

    this.socket.send(JSON.stringify(payload))
    bump(this.context.shared.counters, COUNTER.SENT)
  }

  private connect(field: SharedErrorField) {
    this.phase = 'connecting'

    const socket = new WebSocket(this.context.url)
    this.socket = socket

    socket.on('open', () => {
      this.phase = 'online'

      const { shared } = this.context
      shared.flags[this.index] = (shared.flags[this.index] ?? 0) | DEVICE.CONNECTED

      bump(shared.counters, COUNTER.CONNECTED)
      bump(shared.counters, COUNTER.JOINED)

      this.send({
        type: 'JOIN',
        deviceId: this.deviceId,
        location: this.locationAt(Date.now(), field, 1),
      })

      // Or twenty thousand devices report on the same millisecond and the run
      // measures a thundering herd rather than the API.
      const reportPeriod = 1_000 / this.context.config['report-hz']
      const distancePeriod = 1_000 / this.context.config['distance-hz']

      this.nextReportAt = Date.now() + this.random.float() * reportPeriod
      this.nextDistanceAt = Date.now() + this.random.float() * distancePeriod
      this.lastReportAt = Date.now()
    })

    socket.on('message', (raw: Buffer) => this.receive(raw))

    socket.on('error', () => {
      bump(this.context.shared.counters, COUNTER.ERRORS)
    })

    socket.on('close', () => {
      const wasOnline = this.phase === 'online'
      this.markOffline()

      if (this.phase === 'away') return

      if (wasOnline) bump(this.context.shared.counters, COUNTER.RECONNECTS)

      this.phase = 'waiting'
      this.dueAt = Date.now() + RECONNECT_DELAY_MS
    })
  }

  private markOffline() {
    const { shared } = this.context
    const index = this.index

    if ((shared.flags[index] ?? 0) & DEVICE.CONNECTED) {
      bump(shared.counters, COUNTER.CONNECTED, -1)
    }

    shared.flags[index] = (shared.flags[index] ?? 0) & ~DEVICE.CONNECTED
    this.reportedPeers.clear()
    this.socket = null
  }

  private receive(raw: Buffer) {
    const shared = this.context.shared
    bump(shared.counters, COUNTER.RECEIVED)

    const { success, data } = safeParseJsonMessage(raw.toString(), deviceInbound.schema)
    if (!success || data.type !== 'SET_POINT') return

    writeVector(shared.estimate, this.index, data.position.simulated.relative)
    shared.flags[this.index] = (shared.flags[this.index] ?? 0) | DEVICE.PLACED

    bump(shared.counters, COUNTER.SET_POINTS)
    bump(shared.counters, COUNTER.LATENCY_SUM_MS, Math.round(Date.now() - this.lastReportAt))
    bump(shared.counters, COUNTER.LATENCY_SAMPLES)
  }

  /** Leaves for a while, socket really closed — the API must see it go. */
  private leave() {
    // Set before closing: the close handler reads it to tell a departure from a
    // dropped connection, and only the latter should reconnect immediately.
    this.phase = 'away'
    this.dueAt = Date.now() + this.random.between(AWAY_SECONDS.min, AWAY_SECONDS.max) * 1_000

    this.socket?.close()
    this.markOffline()
  }

  /**
   * Interpolated rather than teleported: a jump would move every distance to
   * every neighbour in one sample, which no sensor produces.
   */
  private relocate(now: number) {
    const spare = this.context.spareSeats
    if (spare.length === 0) return

    const slot = this.random.below(spare.length)
    const target = spare[slot] as number

    spare[slot] = this.seatIndex
    const from = this.truePosition(now)
    this.seatIndex = target

    this.walk = {
      from,
      to: this.seat().point,
      startedAt: now,
      endsAt: now + WALK_SECONDS * 1_000,
    }

    // A new seat means a new sky and a new set of reflecting surfaces.
    this.gnss = new DeviceGnss(this.zone(), this.random, this.context.config['common-mode'])
  }

  private sweepDistances(now: number) {
    const { config, neighborsOf } = this.context
    const peers = neighborsOf(this.index, this.candidates)

    // Sample rather than ranging everyone, so density does not silently raise
    // the message rate.
    const wanted = Math.min(config.neighbors, peers.length)

    for (let i = 0; i < wanted; i++) {
      const pick = i + this.random.below(peers.length - i)
      const swapped = peers[pick] as number
      peers[pick] = peers[i] as number
      peers[i] = swapped
    }

    const truth = this.context.shared.truth
    const here = this.truePosition(now)
    const chosen = new Set<number>()

    for (let i = 0; i < wanted; i++) {
      const peer = peers[i] as number
      chosen.add(peer)

      const distance = Math.hypot(
        (truth[peer * 3] ?? 0) - here.x,
        (truth[peer * 3 + 1] ?? 0) - here.y,
        (truth[peer * 3 + 2] ?? 0) - here.z,
      )

      const sample = this.ranging.measure(distance)

      if (sample.distance !== null) {
        this.send({ type: 'DISTANCE', to: deviceIdFor(peer), distance: sample.distance })
        this.reportedPeers.add(peer)
      } else if (this.reportedPeers.delete(peer)) {
        this.send({ type: 'DISTANCE', to: deviceIdFor(peer), distance: null })
      }
    }

    // Or the graph keeps an edge to someone who walked away — see
    // ./README.md#retracting-edges.
    for (const peer of this.reportedPeers) {
      if (chosen.has(peer)) continue

      this.send({ type: 'DISTANCE', to: deviceIdFor(peer), distance: null })
      this.reportedPeers.delete(peer)
    }
  }

  tick(now: number, field: SharedErrorField, perTickChance: { churn: number; move: number }) {
    if (this.phase === 'waiting' || this.phase === 'away') {
      if (now >= this.dueAt) this.connect(field)
      return
    }

    if (this.phase !== 'online') return

    if (this.walk && now >= this.walk.endsAt) this.walk = null

    if (this.random.bool(perTickChance.churn)) {
      this.leave()
      return
    }

    if (!this.walk && this.random.bool(perTickChance.move)) this.relocate(now)

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
