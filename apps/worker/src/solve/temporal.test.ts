import type { IngestMessage } from '@pollo/contracts'
import { describe, expect, it } from 'vitest'
import { EventGraph } from '../ingest/graph.js'
import {
  buildScenario,
  estimateCloud,
  locationAt,
  Random,
  rmseAgainst,
  type Scenario,
  trueDistance,
} from './fixtures.js'
import { Solver, type SolverOptions } from './solver.js'

const ORIGIN = { latitude: -29.6842, longitude: -53.8069 }

function options(overrides: Partial<SolverOptions> = {}): SolverOptions {
  return {
    anchor: { scale: 1 },
    huberKnee: 2,
    sweepsPerTick: 8,
    convergenceM: 1e-6,
    omega: 1.5,
    scaleBlend: 0.2,
    samplingStride: 3,
    alphaMin: 0.2,
    ...overrides,
  }
}

/**
 * A crowd that keeps reporting, the way a real one does.
 *
 * Every tick every device sends a fresh fix and re-ranges its peers, with error
 * drawn independently each time. This is the situation the temporal step exists
 * for: the information to beat a single reading is already arriving, and a solver
 * that re-answers the snapshot throws it away thirty times a second.
 */
function run(
  scenario: Scenario,
  solverOptions: SolverOptions,
  ticks: number,
  seed: number,
  truthAt: (tick: number) => Float64Array = () => scenario.truth,
) {
  const graph = new EventGraph(ORIGIN)
  const solver = new Solver(solverOptions)
  const random = new Random(seed)

  const sigma = 4
  const verticalSigma = 9

  for (let tick = 0; tick < ticks; tick++) {
    const truth = truthAt(tick)
    const ops: IngestMessage[] = []

    for (let i = 0; i < scenario.count; i++) {
      const at = i * 3

      ops.push({
        op: 'LOCATION_UPDATE',
        deviceId: `d${i}`,
        location: locationAt(
          (truth[at] ?? 0) + random.gaussian() * sigma,
          (truth[at + 1] ?? 0) + random.gaussian() * sigma,
          (truth[at + 2] ?? 0) + random.gaussian() * verticalSigma,
          sigma,
          verticalSigma,
        ),
      })
    }

    for (const [from, to] of scenario.edges) {
      const distance = trueDistance(truth, from, to)
      const noise = random.gaussian() * (0.2 + 0.08 * distance)

      ops.push({
        op: 'DISTANCE',
        from: `d${from}`,
        to: `d${to}`,
        distance: Math.max(0.01, distance + noise),
      })
    }

    graph.applyBatch(ops)
    solver.sync(graph)
    solver.advance(graph)
  }

  return {
    graph,
    solver,
    error: (truth: Float64Array) =>
      rmseAgainst(
        estimateCloud(graph, scenario, slot => solver.at(slot)),
        truth,
        scenario.count,
      ),
  }
}

describe('the temporal step', () => {
  /**
   * What the running mean is worth, which is less than it sounds.
   *
   * Two solvers, same crowd, same readings, differing only in whether they keep
   * a mean. Averaging independent errors should pay √n, and here it pays about
   * five per cent — because most of what is left is not independent error at
   * all. Ranging is a biased way to measure position: a norm is convex, so
   * symmetric noise on a distance does not produce symmetric noise on a shape,
   * and the distortion that follows is a property of the geometry rather than of
   * the draw. No amount of averaging removes it.
   *
   * Five per cent for one counter per device is still worth having. Pretending
   * it is more would be worse than not measuring.
   */
  it('is worth a few per cent once the snapshot is actually solved', () => {
    const scenario = buildScenario({ seed: 51, count: 120 })

    const forgetful = run(scenario, options({ alphaMin: 1, sweepsPerTick: 30 }), 120, 900)
    const remembering = run(scenario, options({ sweepsPerTick: 30 }), 120, 900)

    expect(remembering.error(scenario.truth)).toBeLessThan(forgetful.error(scenario.truth))
  })

  /**
   * And the condition on that, which is the part worth pinning.
   *
   * A mean over answers that are themselves lagging is not a mean over
   * observations. When the sweep budget is too small to solve the window it was
   * given, the estimate is already a filter — an accidental one — and layering a
   * deliberate filter on top adds lag without adding independent looks. The
   * averaging is not free, and the way it stops paying is by being asked to
   * average something that was never converged.
   */
  it('stops paying when the sweep budget is too small to converge', () => {
    const scenario = buildScenario({ seed: 51, count: 120 })

    const forgetful = run(scenario, options({ alphaMin: 1, sweepsPerTick: 4 }), 120, 900)
    const remembering = run(scenario, options({ sweepsPerTick: 4 }), 120, 900)

    expect(remembering.error(scenario.truth)).toBeGreaterThan(forgetful.error(scenario.truth))
  })

  it('keeps improving after the crowd has stopped arriving', () => {
    const scenario = buildScenario({ seed: 52, count: 120 })

    const early = run(scenario, options(), 12, 901)
    const late = run(scenario, options(), 120, 901)

    expect(late.error(scenario.truth)).toBeLessThan(early.error(scenario.truth))
  })

  /**
   * The failure mode the decay creates, and what answers it.
   *
   * A device that has absorbed a hundred windows would, under a true running
   * mean, be held where the crowd first found it forever — and nothing else in
   * the worker would notice, because the graph is perfectly content with the new
   * distances. The floor under the step is the whole answer: it turns the mean
   * into an exponential one over `1 / alphaMin` windows, which is both how much
   * averaging there is and how fast a walk is followed.
   */
  it('follows a device whose owner walked off, after it had settled', () => {
    const scenario = buildScenario({ seed: 53, count: 120 })

    const moved = new Float64Array(scenario.truth)
    moved[0] = (scenario.truth[0] ?? 0) + 9
    moved[1] = (scenario.truth[1] ?? 0) - 7

    // Sixty ticks standing still, then the walk, then thirty more.
    const settled = 60
    const { graph, solver } = run(scenario, options(), settled + 40, 902, tick =>
      tick < settled ? scenario.truth : moved,
    )

    const slot = graph.slotOf('d0') ?? 0
    const point = solver.at(slot)

    const strayed = Math.hypot(point.x - (moved[0] ?? 0), point.y - (moved[1] ?? 0))

    // Within a few metres of where it went, rather than stuck at where it was
    // (which is eleven metres away).
    expect(strayed).toBeLessThan(4)
  })

  /**
   * A still crowd keeps everything it has gathered. Nothing throws evidence
   * away except a device leaving, which is the simplification that replaced a
   * guard that fired on ninety-nine devices out of a hundred and twenty standing
   * perfectly still.
   */
  it('lets a still crowd keep the evidence it has gathered', () => {
    const scenario = buildScenario({ seed: 54, count: 120 })
    const windows = 150

    const { solver, graph } = run(scenario, options(), windows, 903)

    const evidence = [...graph.liveSlots()].map(slot => solver.evidenceAt(slot))

    expect(evidence).toHaveLength(scenario.count)
    expect(evidence.every(seen => seen === windows)).toBe(true)
  })
})
