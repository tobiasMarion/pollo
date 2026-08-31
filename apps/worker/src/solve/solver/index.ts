import {
  anchorWeights,
  blendScale,
  type Csr,
  type GuttmanOptions,
  type GuttmanResult,
  type MdsState,
  type Relaxation,
  type Sample,
  type Scale,
  type Vector3,
} from '@pollo/geometry'
import type { EventGraph } from '../../ingest/graph/index.js'
import { SolverState } from '../state/index.js'

export interface SolverOptions {
  /**
   * Global trust in GPS as a whole. Anchors assume independent error, and GNSS
   * error is not independent — phones a few metres apart read the same
   * satellites through the same sky, so most of what they get wrong they get
   * wrong together.
   */
  anchorScale: number
  /** Where the robust loss bends, in sigmas. */
  huberKnee: number
  /** Sweeps a tick is allowed, before the early break. */
  sweepsPerTick: number
  /** A tick that moved nobody further than this has converged for now. */
  convergenceM: number
  /** Over-relaxation of each update. See `guttman`. */
  omega: number
  /** Every nth edge contributes a residual to the sensor estimate. */
  samplingStride: number
  /** How fast the sensor estimate follows the residuals. */
  scaleBlend: number
  /** What to believe about the sensor before anything has been measured. */
  initialScale: Scale
}

/**
 * What the solver does not build for itself.
 *
 * The sweep and the fit come in as functions so the orchestration — how many
 * sweeps a tick gets, when the mean advances, when the sensor estimate follows —
 * can be driven against a sweep that does something known, rather than only
 * observed through a hundred and twenty devices of real geometry.
 */
export interface SolverDependencies {
  /** The graph, laid out for the sweep. */
  index: Csr
  /** The running mean, one counter per slot. */
  mean: Relaxation
  /** One pass of the transform. */
  sweep: (state: MdsState, options: GuttmanOptions) => GuttmanResult
  /** What the residuals say about the sensor, or nothing worth saying. */
  fitScale: (samples: readonly Sample[]) => Scale | null
}

/**
 * The reconstruction, tick by tick.
 *
 * The blend into the published answer is per **window**, not per tick. Ticks
 * between windows re-solve measurements already seen — they converge and break
 * out early — and folding the same answer into the mean thirty times a second
 * would count one observation as thirty.
 */
export class Solver {
  private readonly state = new SolverState()

  private live: number[] = []
  private currentScale: Scale
  private windowLanded = false

  constructor(
    private readonly deps: SolverDependencies,
    private readonly options: SolverOptions,
  ) {
    this.currentScale = options.initialScale
  }

  get scale(): Scale {
    return this.currentScale
  }

  degreeOf(slot: number) {
    return this.deps.index.degreeOf(slot)
  }

  at(slot: number): Vector3 {
    return this.state.at(slot)
  }

  evidenceAt(slot: number) {
    return this.deps.mean.evidenceAt(slot)
  }

  /**
   * Brings the solver's own state in line with the graph after a window landed.
   *
   * Order matters: released slots are cleared before touched ones are counted,
   * because within one window a device can leave and its slot be handed on.
   */
  sync(graph: EventGraph) {
    this.state.reserve(graph.capacity)

    for (const slot of graph.drainReleased()) {
      this.state.release(slot)
      this.deps.mean.forget(slot)
    }

    const touched = graph.drainTouched()

    this.windowLanded = touched.length > 0

    for (const slot of touched) {
      if (!this.state.isPlaced(slot)) this.state.start(slot, graph.anchors)

      // What a reading is worth changes only when the reading does, and a slot
      // only appears here when something about it changed. Keeping the two
      // weights in a flat array is what lets the sweep stay arithmetic: it never
      // asks what a device is, only what holds this index down.
      const location = graph.locationAt(slot)

      if (location) {
        const weights = anchorWeights(
          location.horizontalAccuracy,
          location.verticalAccuracy,
          this.options.anchorScale,
        )

        this.state.setAnchorWeights(slot, weights.horizontal, weights.vertical)
      }

      this.deps.mean.noteMeasurement(slot)
    }

    if (this.deps.index.rebuildIfStale(graph, graph.version)) this.live = [...graph.liveSlots()]
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
    let samples: readonly Sample[] = []

    for (let i = 0; i < this.options.sweepsPerTick; i++) {
      const result = this.deps.sweep(this.mdsState(graph), {
        huberKnee: this.options.huberKnee,
        omega: this.options.omega,
        samplingStride: this.options.samplingStride,
      })

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

  private mdsState(graph: EventGraph): MdsState {
    return {
      positions: this.state.working,
      anchors: graph.anchors,
      anchorWeights: this.state.anchorWeights,
      slots: this.live,
      graph: this.deps.index,
      scale: this.currentScale,
    }
  }

  /** Folds the freshly solved answer into the running mean, one device at a time. */
  private absorb() {
    for (const slot of this.live) this.state.absorb(slot, this.deps.mean.stepFor(slot))
  }

  /**
   * The sensor estimate follows the residuals, and is deliberately one tick
   * behind the sweep that produced them. Weighting a sweep by a scale derived
   * from that same sweep would be a fixed point of its own, and a tick of lag on
   * a property of the hardware is nothing.
   */
  private updateScale(samples: readonly Sample[]) {
    const fitted = this.deps.fitScale(samples)

    if (!fitted) return

    this.currentScale = blendScale(this.currentScale, fitted, this.options.scaleBlend)
  }
}
