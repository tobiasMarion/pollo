import { parentPort, workerData } from 'node:worker_threads'
import type { Origin } from '@pollo/contracts'
import { buildSeats, occupySeats } from '../crowd/bowl.js'
import { SpatialGrid } from '../crowd/grid.js'
import { buildZones } from '../crowd/zones.js'
import type { SimulatorConfig } from '../io/config.js'
import { type DeviceContext, VirtualDevice } from '../io/device.js'
import { FIELD_TICK_SECONDS, SharedErrorField } from '../noise/gnss.js'
import { deriveSeed, Random } from '../noise/random.js'
import { attach, DEVICE, type SharedBuffers } from './shared.js'

/** How often the shard walks its devices. Fast enough for a 1 Hz report rate. */
const TICK_MS = 50

/** How often the neighbour index is rebuilt. Seats barely move. */
const GRID_REBUILD_MS = 8_000

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
 * One thread's slice of the crowd. The bowl and the error field are rebuilt here
 * rather than passed in — see ./README.md#what-is-not-shared.
 */
function run(data: ShardData) {
  const { buffers, config, from, to, epoch } = data

  const shared = attach(buffers, config.clients)
  const seats = buildSeats(new Random(config.seed))
  const zones = buildZones(seats)
  const occupied = occupySeats(seats, config.clients, new Random(config.seed))

  const field = new SharedErrorField(config.seed, zones.length)
  const grid = new SpatialGrid(
    shared.truth,
    shared.flags,
    config.clients,
    config.range,
    DEVICE.CONNECTED,
  )

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
    zones,
    seats,
    spareSeats,
    neighborsOf: (index, into) => grid.within(index, config.range, into),
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
        new Random(deriveSeed(config.seed, index)),
        context,
      ),
    )
  }

  grid.rebuild()
  let lastGridRebuild = Date.now()

  // Rates arrive per minute and are applied per tick.
  const ticksPerMinute = 60_000 / TICK_MS
  const perTickChance = {
    churn: config.churn / ticksPerMinute,
    move: config['move-prob'] / ticksPerMinute,
  }

  const timer = setInterval(() => {
    const now = Date.now()

    field.advanceTo(Math.floor((now - epoch) / 1_000 / FIELD_TICK_SECONDS))

    if (now - lastGridRebuild >= GRID_REBUILD_MS) {
      grid.rebuild()
      lastGridRebuild = now
    }

    for (const device of devices) device.tick(now, field, perTickChance)
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
