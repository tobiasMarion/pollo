import type { Random } from './random.js'

export interface OuLayer {
  /** Correlation time in seconds — how long the error remembers where it was. */
  tau: number
  /** Standard deviation of the stationary distribution, in meters. */
  sigma: number
}

/**
 * One Ornstein–Uhlenbeck process in exact discrete form, not Euler: the
 * stationary σ then holds at any step size, which matters because the shards
 * step this on whatever interval the event loop gave them.
 *
 * A GPS error is not redrawn every second — it wanders, and it comes back. That
 * is the whole reason for the process: a fresh Gaussian per sample averages away
 * over a few readings, and a random walk runs off to infinity. This does
 * neither.
 */
export class OrnsteinUhlenbeck {
  private state: number

  constructor(
    private readonly layer: OuLayer,
    private readonly random: Random,
  ) {
    // Beginning at zero would give every device a suspiciously good first minute.
    this.state = layer.sigma * random.gaussian()
  }

  get value() {
    return this.state
  }

  step(dt: number) {
    const decay = Math.exp(-dt / this.layer.tau)
    const kick = this.layer.sigma * Math.sqrt(1 - decay * decay)

    this.state = this.state * decay + kick * this.random.gaussian()

    return this.state
  }
}

/**
 * Several processes at once, on different time scales. One τ gives an error that
 * oscillates at exactly one rate, which is a tell; a fast layer over a slow one
 * reads like a fix that jitters while it also drifts across the afternoon.
 */
export class LayeredOu {
  private readonly processes: OrnsteinUhlenbeck[]

  constructor(layers: readonly OuLayer[], random: Random) {
    this.processes = layers.map(layer => new OrnsteinUhlenbeck(layer, random))
  }

  get value() {
    let total = 0
    for (const process of this.processes) total += process.value
    return total
  }

  step(dt: number) {
    let total = 0
    for (const process of this.processes) total += process.step(dt)
    return total
  }
}

/** Layers are independent, so they add in variance rather than in σ. */
export function stationarySigma(layers: readonly OuLayer[]) {
  return Math.sqrt(layers.reduce((sum, layer) => sum + layer.sigma * layer.sigma, 0))
}

/** Three independent layered processes, one per axis of the field frame. */
export class Vector3Ou {
  private readonly x: LayeredOu
  private readonly y: LayeredOu
  private readonly z: LayeredOu

  constructor(horizontal: readonly OuLayer[], vertical: readonly OuLayer[], random: Random) {
    this.x = new LayeredOu(horizontal, random)
    this.y = new LayeredOu(horizontal, random)
    this.z = new LayeredOu(vertical, random)
  }

  get value() {
    return { x: this.x.value, y: this.y.value, z: this.z.value }
  }

  step(dt: number) {
    return { x: this.x.step(dt), y: this.y.step(dt), z: this.z.step(dt) }
  }
}
