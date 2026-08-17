import type { Vector3 } from '@pollo/contracts'
import type { EventGraph } from '../ingest/graph.js'
import { Adjacency } from './adjacency.js'
import { Relaxation, type RelaxationOptions } from './relaxation.js'
import { blendScale, estimateScale, INITIAL_SCALE, type Sample, type Scale } from './scale.js'
import { sweep } from './sweep.js'
import type { AnchorOptions } from './weights.js'

const INITIAL_CAPACITY = 256

export interface SolverOptions extends RelaxationOptions {
  anchor: AnchorOptions
  huberKnee: number
  /** Sweeps a tick is allowed, before the early break. */
  sweepsPerTick: number
  /** A tick that moved nobody further than this has converged for now. */
  convergenceM: number
  /** Over-relaxation of each update. See `sweep`. */
  omega: number
  /** How fast the sensor estimate follows the residuals. */
  scaleBlend: number
  samplingStride: number
}

/**
 * The reconstruction, in two layers.
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
 *
 * The blend is per **window**, not per tick. Ticks between windows re-solve
 * measurements already seen — they converge and break out early — and folding
 * the same answer into the mean thirty times a second would count one
 * observation as thirty.
 */
export class Solver {
  private published = new Float64Array(INITIAL_CAPACITY * 3)
  private working = new Float64Array(INITIAL_CAPACITY * 3)
  private placed = new Uint8Array(INITIAL_CAPACITY)

  private readonly adjacency = new Adjacency()
  private readonly relaxation: Relaxation
  private live: number[] = []
  private currentScale: Scale = INITIAL_SCALE
  private windowLanded = false

  constructor(private readonly options: SolverOptions) {
    this.relaxation = new Relaxation(options)
  }

  get scale(): Scale {
    return this.currentScale
  }

  degreeOf(slot: number) {
    return this.adjacency.degreeOf(slot)
  }

  at(slot: number): Vector3 {
    const base = slot * 3

    return {
      x: this.published[base] ?? 0,
      y: this.published[base + 1] ?? 0,
      z: this.published[base + 2] ?? 0,
    }
  }

  evidenceAt(slot: number) {
    return this.relaxation.evidenceAt(slot)
  }

  /**
   * Brings the solver's own state in line with the graph after a window landed.
   *
   * Order matters: released slots are cleared before touched ones are counted,
   * because within one window a device can leave and its slot be handed on.
   */
  sync(graph: EventGraph) {
    this.reserve(graph.capacity)

    for (const slot of graph.drainReleased()) {
      this.placed[slot] = 0
      this.relaxation.forget(slot)
    }

    const touched = graph.drainTouched()

    this.windowLanded = touched.length > 0

    for (const slot of touched) {
      // A device that has just arrived starts at its own GPS reading.
      //
      // Not at the origin, not at random, and not at the centroid. A
      // reconstruction from distances is invariant to rotation and to
      // reflection, so where it starts decides which of the mirror images it
      // finds — and the anchors are in the same frame as the answer, so starting
      // on them starts in the right one. It is also, on its own, already a
      // defensible position, which means a device is never badly placed on the
      // way to being well placed.
      if (this.placed[slot] === 0) {
        const base = slot * 3
        const x = graph.anchors[base] ?? 0
        const y = graph.anchors[base + 1] ?? 0
        const z = graph.anchors[base + 2] ?? 0

        this.working[base] = x
        this.working[base + 1] = y
        this.working[base + 2] = z

        this.published[base] = x
        this.published[base + 1] = y
        this.published[base + 2] = z

        this.placed[slot] = 1
      }

      this.relaxation.noteMeasurement(slot)
    }

    if (this.adjacency.rebuildIfStale(graph)) this.live = [...graph.liveSlots()]
  }

  /**
   * One tick's worth of solving, and — if this tick had something new to solve —
   * one step of the mean.
   *
   * The sweep budget is a budget, not a target. A crowd that has settled breaks
   * out after the first sweep and gives the rest of the tick back, which is the
   * common case because people stand still.
   */
  advance(graph: EventGraph) {
    if (this.live.length === 0) return 0

    let sweeps = 0
    let samples: Sample[] = []

    for (let i = 0; i < this.options.sweepsPerTick; i++) {
      const result = sweep(
        {
          positions: this.working,
          anchors: graph.anchors,
          slots: this.live,
          locationAt: slot => graph.locationAt(slot),
          adjacency: this.adjacency,
          scale: this.currentScale,
        },
        {
          anchor: this.options.anchor,
          huberKnee: this.options.huberKnee,
          omega: this.options.omega,
          samplingStride: this.options.samplingStride,
        },
      )

      sweeps++

      // Only the last sweep's residuals feed the sensor estimate. The earlier
      // ones describe an answer that has already been improved on.
      samples = result.samples

      if (result.maxDisplacement < this.options.convergenceM) break
    }

    if (this.windowLanded) {
      this.absorb()
      this.windowLanded = false
    }

    this.updateScale(samples)

    return sweeps
  }

  /** Folds the freshly solved answer into the running mean, one device at a time. */
  private absorb() {
    for (const slot of this.live) {
      const base = slot * 3

      const deltaX = (this.working[base] ?? 0) - (this.published[base] ?? 0)
      const deltaY = (this.working[base + 1] ?? 0) - (this.published[base + 1] ?? 0)
      const deltaZ = (this.working[base + 2] ?? 0) - (this.published[base + 2] ?? 0)

      const alpha = this.relaxation.stepFor(slot)

      this.published[base] = (this.published[base] ?? 0) + deltaX * alpha
      this.published[base + 1] = (this.published[base + 1] ?? 0) + deltaY * alpha
      this.published[base + 2] = (this.published[base + 2] ?? 0) + deltaZ * alpha
    }
  }

  /**
   * The sensor estimate follows the residuals, and is deliberately one tick
   * behind the sweep that produced them. Weighting a sweep by a scale derived
   * from that same sweep would be a fixed point of its own, and a tick of lag on
   * a property of the hardware is nothing.
   */
  private updateScale(samples: readonly Sample[]) {
    const fitted = estimateScale(samples)

    if (!fitted) return

    this.currentScale = blendScale(this.currentScale, fitted, this.options.scaleBlend)
  }

  private reserve(capacity: number) {
    if (capacity * 3 <= this.published.length) return

    const size = Math.max(capacity, this.placed.length * 2)

    const published = new Float64Array(size * 3)
    published.set(this.published)
    this.published = published

    const working = new Float64Array(size * 3)
    working.set(this.working)
    this.working = working

    const placed = new Uint8Array(size)
    placed.set(this.placed)
    this.placed = placed
  }
}
