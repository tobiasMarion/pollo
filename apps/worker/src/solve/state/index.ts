import type { Vector3 } from '@pollo/geometry'

const INITIAL_CAPACITY = 256

/**
 * The arrays the solve lives in, and the only thing here that grows.
 *
 * **`working`** is the answer to the measurements that have arrived: the sweeps
 * drive it, warm-started from wherever it already was, and it chases whatever the
 * latest window says. **`published`** is what the crowd is told, and it moves
 * only a fraction of the way to `working` each time a window lands.
 *
 * They have to be two things. Damping the sweep itself was the first attempt and
 * it does not work: with eight sweeps in a tick, a step of a fifth applied eight
 * times gets five sixths of the way there anyway, so the averaging is undone
 * inside the very tick that was supposed to accumulate it. Worse, it slows the
 * sweeps down, so the snapshot is solved less well *and* not averaged. Solving
 * hard and remembering slowly are separate jobs and want separate knobs.
 */
export class SolverState {
  published = new Float64Array(INITIAL_CAPACITY * 3)
  working = new Float64Array(INITIAL_CAPACITY * 3)
  /** Whether a slot has ever been given a starting position. */
  placed = new Uint8Array(INITIAL_CAPACITY)
  /** Horizontal and vertical anchor weight, two per slot. Zero means unanchored. */
  anchorWeights = new Float64Array(INITIAL_CAPACITY * 2)

  isPlaced(slot: number) {
    return this.placed[slot] === 1
  }

  at(slot: number): Vector3 {
    const base = slot * 3

    return {
      x: this.published[base] ?? 0,
      y: this.published[base + 1] ?? 0,
      z: this.published[base + 2] ?? 0,
    }
  }

  /**
   * A device that has just arrived starts at its own GPS reading.
   *
   * Not at the origin, not at random, and not at the centroid. A reconstruction
   * from distances is invariant to rotation and to reflection, so where it
   * starts decides which of the mirror images it finds — and the anchors are in
   * the same frame as the answer, so starting on them starts in the right one.
   * It is also, on its own, already a defensible position, which means a device
   * is never badly placed on the way to being well placed.
   */
  start(slot: number, anchors: Readonly<Float64Array>) {
    const base = slot * 3

    for (let axis = 0; axis < 3; axis++) {
      const value = anchors[base + axis] ?? 0

      this.working[base + axis] = value
      this.published[base + axis] = value
    }

    this.placed[slot] = 1
  }

  setAnchorWeights(slot: number, horizontal: number, vertical: number) {
    this.anchorWeights[slot * 2] = horizontal
    this.anchorWeights[slot * 2 + 1] = vertical
  }

  /** A freed slot keeps nothing of its previous tenant. */
  release(slot: number) {
    this.placed[slot] = 0
    this.setAnchorWeights(slot, 0, 0)
  }

  /** Moves the published answer a fraction of the way to the working one. */
  absorb(slot: number, alpha: number) {
    const base = slot * 3

    for (let axis = 0; axis < 3; axis++) {
      const held = this.published[base + axis] ?? 0
      const solved = this.working[base + axis] ?? 0

      this.published[base + axis] = held + (solved - held) * alpha
    }
  }

  reserve(capacity: number) {
    if (capacity <= this.placed.length) return

    const size = Math.max(capacity, this.placed.length * 2)

    this.published = grown(this.published, size * 3)
    this.working = grown(this.working, size * 3)
    this.anchorWeights = grown(this.anchorWeights, size * 2)

    const placed = new Uint8Array(size)
    placed.set(this.placed)
    this.placed = placed
  }
}

function grown(from: Float64Array, length: number) {
  const to = new Float64Array(length)

  to.set(from)

  return to
}
