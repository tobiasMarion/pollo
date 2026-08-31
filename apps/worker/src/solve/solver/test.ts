import { Csr, type GuttmanResult, type MdsState, Relaxation } from '@pollo/geometry'
import { describe, expect, it } from 'vitest'
import type { EventGraph } from '../../ingest/graph/index.js'
import {
  anchorCloud,
  buildScenario,
  estimateCloud,
  graphOf,
  INITIAL_SCALE,
  rmseAgainst,
  type ScenarioOptions,
  solverOf,
  solverOptions,
} from '../fixtures/index.js'
import { Solver } from './index.js'

/** Runs a fixed scenario to a standstill and reports both clouds. */
function reconstruct(scenario: ScenarioOptions, ticks = 60, solver = solverOf()) {
  const built = buildScenario(scenario)
  const graph = graphOf(built)

  for (let tick = 0; tick < ticks; tick++) {
    solver.sync(graph)
    solver.advance(graph)
  }

  return {
    built,
    graph,
    solver,
    worker: rmseAgainst(
      estimateCloud(graph, built, slot => solver.at(slot)),
      built.truth,
      built.count,
    ),
    anchors: rmseAgainst(anchorCloud(graph, built), built.truth, built.count),
  }
}

describe('Solver', () => {
  it('recovers a layout exactly when the distances are exact', () => {
    // Perfect anchors and perfect distances: the objective's minimum is the
    // truth, so anything but the truth is the solver failing to find it.
    const { worker } = reconstruct(
      {
        seed: 7,
        count: 80,
        anchorSigma: 0.001,
        anchorVerticalSigma: 0.001,
        rangeFloor: 0,
        rangeRelative: 0,
      },
      200,
    )

    expect(worker).toBeLessThan(0.01)
  })

  it('beats raw GPS on an ordinary crowd', () => {
    const { worker, anchors } = reconstruct({ seed: 11, count: 150 })

    expect(worker).toBeLessThan(anchors)
    // Not a marginal win — distances are centimetres and GPS is metres.
    expect(worker).toBeLessThan(anchors / 2)
  })

  /**
   * The regimes, one assertion each. A solver that only survives well-behaved
   * Gaussian noise has been tuned to well-behaved Gaussian noise, and the field
   * does not supply it.
   */
  const regimes: Array<[string, ScenarioOptions]> = [
    ['a dense knot with thin space between', { layout: 'cluster', seed: 3 }],
    ['people standing above other people', { layout: 'tower', seed: 4 }],
    ['two groups nothing measures across', { layout: 'islands', seed: 5 }],
    ['a heavy-tailed sensor', { noise: 'heavy', seed: 6 }],
    ['one measurement in twenty being nonsense', { outlierRate: 0.05, seed: 8 }],
    ['a sensor that reads long', { noise: 'biased', seed: 9 }],
    ['a crowd that is wrong together', { commonBias: [6, -4, 0], seed: 10 }],
    ['a sensor ten times noisier than expected', { rangeFloor: 2, rangeRelative: 0.4, seed: 12 }],
  ]

  for (const [name, scenario] of regimes) {
    it(`beats raw GPS with ${name}`, () => {
      const { worker, anchors } = reconstruct({ count: 120, ...scenario })

      expect(worker).toBeLessThan(anchors)
    })
  }

  /**
   * A chain has degree two and almost no rigidity — the anchors are most of what
   * holds it. Beating GPS is not the bar here; not falling apart is.
   */
  it('does not come apart on a single file of people', () => {
    const { worker, anchors } = reconstruct({ layout: 'chain', count: 60, seed: 13 })

    expect(Number.isFinite(worker)).toBe(true)
    expect(worker).toBeLessThan(anchors * 1.1)
  })

  it('finds the sensor it was never told about', () => {
    for (const [floor, relative] of [
      [0.05, 0.02],
      [0.4, 0.1],
      [1.2, 0.25],
    ]) {
      const { solver } = reconstruct({
        seed: 21,
        count: 200,
        rangeFloor: floor,
        rangeRelative: relative,
        anchorSigma: 0.5,
        anchorVerticalSigma: 0.5,
      })

      const scale = solver.scale

      // Within a factor of three of the truth, from a start that knew nothing.
      // The claim is that it finds the order of magnitude on its own, not that
      // it nails a constant.
      const sigmaAtFive = scale.floor + scale.relative * 5
      const truthAtFive = (floor ?? 0) + (relative ?? 0) * 5

      expect(sigmaAtFive).toBeGreaterThan(truthAtFive / 3)
      expect(sigmaAtFive).toBeLessThan(truthAtFive * 3 + 0.3)
      expect(scale).not.toEqual(INITIAL_SCALE)
    }
  })

  it('gives the same answer twice', () => {
    const first = reconstruct({ seed: 33, count: 90 })
    const second = reconstruct({ seed: 33, count: 90 })

    const a = estimateCloud(first.graph, first.built, slot => first.solver.at(slot))
    const b = estimateCloud(second.graph, second.built, slot => second.solver.at(slot))

    expect([...a]).toEqual([...b])
  })

  it('leaves a device with nothing measuring it on its own reading', () => {
    const built = buildScenario({ count: 4, seed: 41 })
    const graph = graphOf({ ...built, edges: [] })
    const solver = solverOf()

    solver.sync(graph)
    solver.advance(graph)

    const slot = graph.slotOf('d2') ?? 0

    expect(solver.at(slot)).toEqual(graph.anchorAt(slot))
  })

  it('produces numbers when two devices are in the same place', () => {
    const built = buildScenario({ count: 3, seed: 42 })
    const graph = graphOf({
      ...built,
      // Both directions, distance zero: the direction between them is undefined.
      edges: [
        [0, 1, 0.01],
        [1, 0, 0.01],
      ],
    })
    const solver = solverOf()

    for (let tick = 0; tick < 20; tick++) {
      solver.sync(graph)
      solver.advance(graph)
    }

    for (let i = 0; i < 3; i++) {
      const point = solver.at(graph.slotOf(`d${i}`) ?? 0)

      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
      expect(Number.isFinite(point.z)).toBe(true)
    }
  })

  it('drops a device that left without disturbing the rest', () => {
    const built = buildScenario({ count: 40, seed: 43 })
    const graph: EventGraph = graphOf(built)
    const solver = solverOf()

    for (let tick = 0; tick < 10; tick++) {
      solver.sync(graph)
      solver.advance(graph)
    }

    graph.apply({ op: 'LEAVE', deviceId: 'd5' })
    solver.sync(graph)
    solver.advance(graph)

    expect(graph.slotOf('d5')).toBeUndefined()

    const survivor = solver.at(graph.slotOf('d6') ?? 0)

    expect(Number.isFinite(survivor.x)).toBe(true)
  })

  /**
   * What the sweep budget is: a budget, not a target. A crowd that has settled
   * breaks out after the first pass and gives the rest of the tick back, which
   * is the common case because people stand still.
   *
   * Driven against a sweep that reports a known displacement, because observing
   * this through a hundred and twenty devices of real geometry means observing
   * it through everything else as well.
   */
  it('spends its whole budget on a crowd that is moving and one sweep on one that is not', () => {
    const displacements: number[] = []
    const built = buildScenario({ count: 20, seed: 61 })
    const graph = graphOf(built)

    const sweep = (_state: MdsState): GuttmanResult => ({
      maxDisplacement: displacements.shift() ?? 0,
      samples: [],
    })

    const solver = new Solver(
      { index: new Csr(), mean: new Relaxation({ alphaMin: 0.2 }), sweep, fitScale: () => null },
      solverOptions({ sweepsPerTick: 8, convergenceM: 0.01 }),
    )

    solver.sync(graph)

    displacements.push(...Array.from({ length: 10 }, () => 1))
    expect(solver.advance(graph)).toBe(8)

    displacements.length = 0
    displacements.push(0.001)
    expect(solver.advance(graph)).toBe(1)
  })

  /**
   * The blend into the published answer is per **window**, not per tick. Ticks
   * between windows re-solve measurements already seen, and folding the same
   * answer into the mean thirty times a second would count one observation as
   * thirty.
   */
  it('advances the mean once per window, however many ticks it solves for', () => {
    const built = buildScenario({ count: 20, seed: 62 })
    const graph = graphOf(built)

    const sweep = (): GuttmanResult => ({ maxDisplacement: 0, samples: [] })

    const solver = new Solver(
      { index: new Csr(), mean: new Relaxation({ alphaMin: 0.2 }), sweep, fitScale: () => null },
      solverOptions(),
    )

    for (let tick = 0; tick < 20; tick++) {
      solver.sync(graph)
      solver.advance(graph)
    }

    // One window landed — the scenario was applied once — so the crowd has one
    // observation apiece, not twenty.
    expect(solver.evidenceAt(graph.slotOf('d0') ?? 0)).toBe(1)
  })
})
