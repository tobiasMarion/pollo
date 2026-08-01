/**
 * A seeded generator: a run that cannot be replayed turns a defect into an
 * anecdote. See ./README.md#randomness.
 */
export class Random {
  private s0: number
  private s1: number
  private s2: number
  private s3: number

  private spare: number | null = null

  constructor(seed: number) {
    // xoshiro is only as good as its seeding: a state of mostly zeros takes a
    // long time to recover.
    let state = seed >>> 0

    const splitmix32 = () => {
      state = (state + 0x9e37_79b9) | 0
      let t = state ^ (state >>> 16)
      t = Math.imul(t, 0x21f0_aaad)
      t = t ^ (t >>> 15)
      t = Math.imul(t, 0x735a_2d97)
      return (t ^ (t >>> 15)) >>> 0
    }

    this.s0 = splitmix32()
    this.s1 = splitmix32()
    this.s2 = splitmix32()
    this.s3 = splitmix32()
  }

  /** xoshiro128\*\* — 32 bits per call, no allocation, no modulo bias. */
  private nextUint32() {
    const result = Math.imul(rotateLeft(Math.imul(this.s1, 5), 7), 9) >>> 0
    const t = (this.s1 << 9) >>> 0

    this.s2 ^= this.s0
    this.s3 ^= this.s1
    this.s1 ^= this.s2
    this.s0 ^= this.s3
    this.s2 ^= t
    this.s3 = rotateLeft(this.s3, 11)

    return result
  }

  /** Uniform in [0, 1). */
  float() {
    return this.nextUint32() / 0x1_0000_0000
  }

  /** Uniform in [min, max). */
  between(min: number, max: number) {
    return min + this.float() * (max - min)
  }

  /** Uniform integer in [0, bound). */
  below(bound: number) {
    return Math.floor(this.float() * bound)
  }

  bool(probability: number) {
    return this.float() < probability
  }

  /** Box–Muller. The spare is the transform's second sample, not a cache. */
  gaussian() {
    if (this.spare !== null) {
      const value = this.spare
      this.spare = null
      return value
    }

    // `float()` can return exactly 0, and log(0) is -Infinity.
    const u = 1 - this.float()
    const v = this.float()

    const magnitude = Math.sqrt(-2 * Math.log(u))
    const angle = 2 * Math.PI * v

    this.spare = magnitude * Math.sin(angle)
    return magnitude * Math.cos(angle)
  }

  /** Exponential with the given mean — dwell times and inter-arrival gaps. */
  exponential(mean: number) {
    return -Math.log(1 - this.float()) * mean
  }

  /**
   * Marsaglia–Tsang. Multipath needs a positive magnitude with a tail, which a
   * normal cannot give and a uniform will not.
   */
  gamma(shape: number, scale: number): number {
    // The method needs shape >= 1; below that it is boosted and scaled back.
    if (shape < 1) return this.gamma(shape + 1, scale) * this.float() ** (1 / shape)

    const d = shape - 1 / 3
    const c = 1 / Math.sqrt(9 * d)

    for (;;) {
      const normal = this.gaussian()
      const v = (1 + c * normal) ** 3

      if (v <= 0) continue

      const uniform = this.float()

      if (uniform < 1 - 0.033_1 * normal ** 4) return d * v * scale
      if (Math.log(uniform) < 0.5 * normal ** 2 + d * (1 - v + Math.log(v))) return d * v * scale
    }
  }

  /** Uniform on the unit sphere — see ./README.md#the-distributions. */
  unitVector() {
    const z = this.between(-1, 1)
    const angle = this.between(0, 2 * Math.PI)
    const radius = Math.sqrt(1 - z * z)

    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z }
  }
}

function rotateLeft(value: number, bits: number) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

/**
 * Keyed by global index, not by the order streams were handed out, so `--threads`
 * cannot change what a device does.
 */
export function deriveSeed(seed: number, index: number) {
  let mixed = (seed ^ Math.imul(index + 1, 0x9e37_79b9)) >>> 0

  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0_aaad) >>> 0
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a_2d97) >>> 0

  return (mixed ^ (mixed >>> 15)) >>> 0
}
