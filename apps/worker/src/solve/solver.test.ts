import { describe, expect, it } from 'vitest'
import type { EventGraph } from '../ingest/graph.js'
import {
  anchorCloud,
  buildScenario,
  estimateCloud,
  graphOf,
  rmseAgainst,
  type ScenarioOptions,
} from './fixtures.js'
import { INITIAL_SCALE } from './scale.js'
import { Solver, type SolverOptions } from './solver.js'

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

/** Runs a fixed scenario to a standstill and reports both clouds. */
function reconstruct(scenario: ScenarioOptions, ticks = 60, solverOptions = options()) {
  const built = buildScenario(scenario)
  const graph = graphOf(built)
  const solver = new Solver(solverOptions)

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
    const solver = new Solver(options())

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
    const solver = new Solver(options())

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
    const solver = new Solver(options())

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
})
