import type { Vector3 } from '@pollo/contracts'
import { type OuLayer, Vector3Ou } from './ou.js'
import type { Random } from './random.js'

/**
 * How far somebody drifts around the spot they are standing on, and how slowly.
 * People shift their weight, lean, turn to talk — over a minute that is a good
 * fraction of a metre, and it never becomes walking away.
 */
const HORIZONTAL: OuLayer[] = [{ tau: 20, sigma: 0.12 }]

/** Standing up and crouching back down, mostly. Smaller, and slower. */
const VERTICAL: OuLayer[] = [{ tau: 30, sigma: 0.04 }]

/**
 * The small, endless motion of a person who has not gone anywhere.
 *
 * It is what keeps the distance graph alive: without it every pair of
 * neighbours reports the same true distance for the length of the run, and the
 * only thing that ever changes is the measurement error. A worker tested
 * against that has been tested against a still photograph.
 */
export class Sway {
  private readonly process: Vector3Ou

  constructor(random: Random) {
    this.process = new Vector3Ou(HORIZONTAL, VERTICAL, random)
  }

  step(dt: number): Vector3 {
    return this.process.step(dt)
  }

  get value(): Vector3 {
    return this.process.value
  }
}
