import { describe, expect, it } from 'vitest'
import { cloud, csrOf, type Edge, rmse, stateOf } from '../fixtures/index.js'
import type { Scale } from '../sigma/index.js'
import { type MdsState, stress } from '../stress/index.js'
import { guttman } from './index.js'

const scale: Scale = { floor: 0.2, relative: 0.08 }

/** Plain majorization: the step pinned to one, the robust loss switched off. */
const pure = { huberKnee: Number.POSITIVE_INFINITY, omega: 1, samplingStride: 1 }

function sweepUntil(state: MdsState, passes: number, options = pure) {
  for (let i = 0; i < passes; i++) guttman(state, options)
}

describe('guttman', () => {
  /**
   * The claim the whole design rests on.
   *
   * Each sweep exactly minimises a function that sits above the real objective
   * and touches it at the current answer, so the real objective cannot go up.
   * Asserted with the step pinned to 1 and the robust loss switched off, because
   * those are the two things that make a running solver something other than
   * pure majorization: over-relaxation throws each point past its own answer,
   * and the Huber weights change the objective between sweeps. If this fails,
   * the transform is wrong.
   */
  it('never lets the objective rise', () => {
    const state = stateOf(cloud({ seed: 101, count: 100 }), scale)

    let previous = stress(state)

    expect(previous).toBeGreaterThan(0)

    for (let i = 0; i < 40; i++) {
      guttman(state, pure)

      const current = stress(state)

      // Equality is allowed: a converged sweep moves nothing.
      expect(current).toBeLessThanOrEqual(previous * (1 + 1e-12))
      previous = current
    }
  })

  it('actually descends rather than merely not rising', () => {
    const state = stateOf(cloud({ seed: 102, count: 100 }), scale)
    const before = stress(state)

    sweepUntil(state, 40)

    expect(stress(state)).toBeLessThan(before / 2)
  })

  /**
   * Not a convergence rate — a direction. Undamped majorization on a graph this
   * size is slow, and how slow is exactly why a running solver over-relaxes;
   * what has to be true here is that it is heading somewhere and not circling.
   */
  it('settles rather than circling', () => {
    const state = stateOf(cloud({ seed: 103, count: 100 }), scale)
    const displacements: number[] = []

    for (let i = 0; i < 120; i++) displacements.push(guttman(state, pure).maxDisplacement)

    expect(displacements[119] ?? 0).toBeLessThan((displacements[10] ?? 0) / 4)
  })

  /** The over-relaxation earns its place, on the same graph and the same budget. */
  it('gets further in the same number of sweeps when over-relaxed', () => {
    const built = cloud({ seed: 103, count: 100 })

    const plain = stateOf(built, scale)
    const relaxed = stateOf(built, scale)

    sweepUntil(plain, 30)
    sweepUntil(relaxed, 30, { ...pure, omega: 1.5 })

    expect(stress(relaxed)).toBeLessThan(stress(plain))
  })

  /**
   * Exact distances and exact anchors put the objective's minimum on the truth,
   * so anything but the truth is the transform failing to find it.
   */
  it('recovers the layout when nothing is noisy', () => {
    const built = cloud({
      seed: 104,
      count: 60,
      anchorSigma: 1e-6,
      anchorVerticalSigma: 1e-6,
      rangeFloor: 0,
      rangeRelative: 0,
    })

    const state = stateOf(built, scale)

    sweepUntil(state, 300)

    expect(rmse(state.positions, built.truth, built.count)).toBeLessThan(0.01)
  })

  it('samples residuals for the scale estimate as it goes', () => {
    const state = stateOf(cloud({ seed: 105, count: 100 }), scale)

    const dense = guttman(state, { huberKnee: 2, omega: 1, samplingStride: 1 })
    const sparse = guttman(state, { huberKnee: 2, omega: 1, samplingStride: 4 })

    expect(dense.samples.length).toBeGreaterThan(20)
    expect(dense.samples.every(sample => Number.isFinite(sample.residual))).toBe(true)
    expect(sparse.samples.length).toBeCloseTo(dense.samples.length / 4, -1)
  })

  /**
   * Two points on top of each other have no direction between them, and
   * inventing one would be picking a random answer and calling it a fit.
   */
  it('produces numbers for two points in the same place', () => {
    const state: MdsState = {
      positions: Float64Array.from([0, 0, 0, 0, 0, 0]),
      anchors: Float64Array.from([0, 0, 0, 0, 0, 0]),
      anchorWeights: Float64Array.from([1, 1, 1, 1]),
      slots: [0, 1],
      graph: csrOf(2, [
        [0, 1, 4],
        [1, 0, 4],
      ]),
      scale,
    }

    sweepUntil(state, 10)

    expect([...state.positions].every(Number.isFinite)).toBe(true)
  })

  it('leaves a point that nothing measures and nothing anchors exactly where it is', () => {
    const state: MdsState = {
      positions: Float64Array.from([42, -7, 3]),
      anchors: Float64Array.from([0, 0, 0]),
      anchorWeights: Float64Array.from([0, 0]),
      slots: [0],
      graph: csrOf(1, []),
      scale,
    }

    const result = guttman(state, pure)

    expect([...state.positions]).toEqual([42, -7, 3])
    expect(result.maxDisplacement).toBe(0)
  })

  /**
   * The anchor is not isotropic, and numerator and denominator are kept per axis
   * for that reason: a reading trusted across the ground and distrusted in
   * height must hold a point down horizontally while letting its altitude give
   * way.
   *
   * Two points twenty metres apart, both anchored at the origin — one held hard
   * on every axis, the other held hard horizontally and barely at all in height.
   * The distance has to be satisfied somewhere, and the axis it is satisfied on
   * is the one the weights left free.
   */
  it('satisfies a distance on the axis the anchor left free', () => {
    const state: MdsState = {
      positions: Float64Array.from([0, 0, 0, 14, 0, 14]),
      anchors: Float64Array.from([0, 0, 0, 0, 0, 0]),
      anchorWeights: Float64Array.from([1e9, 1e9, 1, 1e-6]),
      slots: [0, 1],
      graph: csrOf(2, [[0, 1, 20] as Edge]),
      scale,
    }

    sweepUntil(state, 200)

    const east = Math.abs(state.positions[3] ?? 0)
    const up = Math.abs(state.positions[5] ?? 0)

    expect(up).toBeGreaterThan(19)
    expect(east).toBeLessThan(0.1)
  })
})
