import { parentPort, workerData } from 'node:worker_threads'
import type { Effect, Origin } from '@pollo/contracts'
import { SpatialGrid } from '../crowd/grid.js'
import { occupy } from '../crowd/occupancy.js'
import { capacityFor, venues } from '../crowd/venue.js'
import { fetchParticipants } from '../io/api.js'
import type { SimulatorConfig } from '../io/config.js'
import { type DeviceContext, perTickChance, VirtualDevice } from '../io/device.js'
import { webSocketTransport } from '../io/transport.js'
import { FIELD_TICK_SECONDS, SharedErrorField } from '../noise/gnss.js'
import { deriveSeed, Random } from '../noise/random.js'
import { attach, DEVICE, type SharedBuffers } from './shared.js'

/** How often the shard walks its devices. Fast enough for a 1 Hz report rate. */
const TICK_MS = 50

/** How often the neighbour index is rebuilt. Nobody moves far between rebuilds. */
const GRID_REBUILD_MS = 8_000

/** How long a cue stays the same cue, for the purpose of only reporting it once. */
const CUE_COALESCE_MS = 250

/** A cue one of this shard's devices heard, on its way to the terminal. */
export interface ShardEffect {
  type: 'effect'
  effect: Effect
  /** When the device heard it — the clock the brightness is measured from. */
  at: number
}

export interface ShardData {
  buffers: SharedBuffers
  config: SimulatorConfig
  url: string
  origin: Origin
  /** Devices [from, to) belong to this shard. */
  from: number
  to: number
  /** Which of how many shards this is — used to divide the empty seats up. */
  ordinal: number
  shards: number
  /** Shared start of the run, so every shard agrees on the error field's clock. */
  epoch: number
}

/**
 * One thread's slice of the crowd.
 *
 * The venue and the error field are rebuilt here rather than passed in: they are
 * pure functions of the seed, so every shard derives the same crowd and the same
 * weather without anything crossing a thread boundary.
 */
function run(data: ShardData) {
  const { buffers, config, from, to, epoch } = data

  const shared = attach(buffers, config.clients)
  const venue = venues[config.venue]

  const seats = venue.build(capacityFor(config.clients), new Random(config.seed))
  const occupied = occupy(seats.length, config.clients, new Random(config.seed))

  const field = new SharedErrorField(new Random(deriveSeed(config.seed, 0)))
  const grid = new SpatialGrid(
    shared.truth,
    shared.flags,
    config.clients,
    config.range,
    DEVICE.CONNECTED,
  )

  /**
   * A cue reaches every device on this thread within a millisecond or two of
   * itself, and the terminal needs it once. Coalescing on the payload keeps the
   * two cases apart that a plain time window would merge: a different cue always
   * gets through, and only a repeat of the same one inside the window is dropped
   * — which is a pad double-tapped by hand, not something the crowd can produce.
   */
  let lastCue: { payload: string; at: number } | null = null

  const forwardCue = (effect: Effect) => {
    const payload = JSON.stringify(effect)
    const at = Date.now()

    if (lastCue && lastCue.payload === payload && at - lastCue.at < CUE_COALESCE_MS) return

    lastCue = { payload, at }
    parentPort?.postMessage({ type: 'effect', effect, at } satisfies ShardEffect)
  }

  // Disjoint per shard, so two threads can never walk a device into the same
  // seat and no locking is needed to prevent it.
  const taken = new Set(occupied)
  const spareSeats: number[] = []
  let empty = 0

  for (let seat = 0; seat < seats.length; seat++) {
    if (taken.has(seat)) continue
    if (empty++ % data.shards === data.ordinal) spareSeats.push(seat)
  }

  const context: DeviceContext = {
    url: data.url,
    origin: data.origin,
    config,
    shared,
    budget: venue.sigma,
    seats,
    spareSeats,
    neighborsOf: (index, into) => grid.within(index, config.range, into),
    connect: webSocketTransport,
    roster: () => fetchParticipants(config.api, config.event),
    onEffect: forwardCue,
  }

  const devices: VirtualDevice[] = []

  for (let index = from; index < to; index++) {
    // By global index, not by position within the shard: otherwise every thread
    // opens its first socket at once and the ramp only staggers the tail.
    const connectAt = epoch + (index / config.clients) * config.ramp * 1_000

    devices.push(
      new VirtualDevice(
        index,
        occupied[index] as number,
        connectAt,
        new Random(deriveSeed(config.seed, index + 1)),
        context,
      ),
    )
  }

  grid.rebuild()
  let lastGridRebuild = Date.now()

  const chance = perTickChance(config, TICK_MS)

  const timer = setInterval(() => {
    const now = Date.now()

    field.advanceTo(Math.floor((now - epoch) / 1_000 / FIELD_TICK_SECONDS))

    if (now - lastGridRebuild >= GRID_REBUILD_MS) {
      grid.rebuild()
      lastGridRebuild = now
    }

    for (const device of devices) device.tick(now, field, chance)
  }, TICK_MS)

  parentPort?.on('message', (message: { type: string }) => {
    if (message.type !== 'stop') return

    clearInterval(timer)
    for (const device of devices) device.stop()
    parentPort?.postMessage({ type: 'stopped' })
  })

  parentPort?.postMessage({ type: 'ready', devices: devices.length })
}

run(workerData as ShardData)
