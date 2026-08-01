/**
 * State every shard reads and the main thread aggregates, in `SharedArrayBuffer`
 * rather than messages. See ./README.md#why-shared-memory.
 */

/** Bits in the per-device flag byte. */
export const DEVICE = {
  CONNECTED: 1,
  /** The worker has placed this device at least once. */
  PLACED: 2,
  /** The device has reported a GPS fix at least once. */
  REPORTED: 4,
} as const

/** Indices into the shared counter array. All updated with `Atomics.add`. */
export const COUNTER = {
  SENT: 0,
  RECEIVED: 1,
  CONNECTED: 2,
  JOINED: 3,
  ERRORS: 4,
  RECONNECTS: 5,
  LATENCY_SUM_MS: 6,
  LATENCY_SAMPLES: 7,
  SET_POINTS: 8,
} as const

const COUNTER_SLOTS = Object.keys(COUNTER).length

export interface SharedBuffers {
  truth: SharedArrayBuffer
  reported: SharedArrayBuffer
  estimate: SharedArrayBuffer
  flags: SharedArrayBuffer
  counters: SharedArrayBuffer
}

export interface SharedState {
  count: number
  /** Where the device really is, in meters east/north/up of the event origin. */
  truth: Float32Array
  /** Where its own GPS says it is — the control the worker has to beat. */
  reported: Float32Array
  /** Where the worker put it. */
  estimate: Float32Array
  flags: Uint8Array
  counters: Int32Array
}

export function createSharedBuffers(count: number): SharedBuffers {
  const vectors = () => new SharedArrayBuffer(count * 3 * Float32Array.BYTES_PER_ELEMENT)

  return {
    truth: vectors(),
    reported: vectors(),
    estimate: vectors(),
    flags: new SharedArrayBuffer(count),
    counters: new SharedArrayBuffer(COUNTER_SLOTS * Int32Array.BYTES_PER_ELEMENT),
  }
}

export function attach(buffers: SharedBuffers, count: number): SharedState {
  return {
    count,
    truth: new Float32Array(buffers.truth),
    reported: new Float32Array(buffers.reported),
    estimate: new Float32Array(buffers.estimate),
    flags: new Uint8Array(buffers.flags),
    counters: new Int32Array(buffers.counters),
  }
}

export function writeVector(
  target: Float32Array,
  index: number,
  point: { x: number; y: number; z: number },
) {
  target[index * 3] = point.x
  target[index * 3 + 1] = point.y
  target[index * 3 + 2] = point.z
}

export function bump(counters: Int32Array, counter: number, by = 1) {
  Atomics.add(counters, counter, by)
}

/** Read and reset, so a rate needs no agreement about when the last read was. */
export function drain(counters: Int32Array, counter: number) {
  return Atomics.exchange(counters, counter, 0)
}

export function read(counters: Int32Array, counter: number) {
  return Atomics.load(counters, counter)
}
