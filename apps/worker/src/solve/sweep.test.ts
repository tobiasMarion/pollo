import { describe, expect, it } from 'vitest'
import { Adjacency } from './adjacency.js'
import { buildScenario, graphOf } from './fixtures.js'
import type { Scale } from './scale.js'
import { stress } from './stress.js'
import { sweep } from './sweep.js'

const anchor = { scale: 1 }
const scale: Scale = { floor: 0.2, relative: 0.08 }

function bench(scenarioSeed: number, count = 100) {
  const built = buildScenario({ seed: scenarioSeed, count })
  const graph = graphOf(built)

  const adjacency = new Adjacency()
  adjacency.rebuildIfStale(graph)

  const slots = [...graph.liveSlots()]
  const positions = new Float64Array(graph.capacity * 3)

  for (const slot of slots) {
    const base = slot * 3
    positions[base] = graph.anchors[base] ?? 0
    positions[base + 1] = graph.anchors[base + 1] ?? 0
    positions[base + 2] = graph.anchors[base + 2] ?? 0
  }

  const state = {
    positions,
    anchors: graph.anchors,
    slots,
    locationAt: (slot: number) => graph.locationAt(slot),
    adjacency,
    scale,
  }

  const measure = () =>
    stress({
      positions,
      anchors: graph.anchors,
      slots,
      locationAt: state.locationAt,
      adjacency,
      scale,
      anchor,
    })

  return { state, measure, graph, slots }
}

describe('sweep', () => {
  /**
   * The claim the whole design rests on.
   *
   * Majorization means each sweep exactly minimises a function that sits above
   * the real objective and touches it at the current answer — so the real
   * objective cannot go up. Asserted with the step pinned to 1 and the robust
   * loss switched off, because those are the two things that make the running
   * solver something other than pure majorization: a fractional step is a filter
   * and the Huber weights change the objective between sweeps. If this fails,
   * the transform is wrong.
   */
  it('never lets the objective rise', () => {
    const { state, measure } = bench(101)

    let previous = measure()

    expect(previous).toBeGreaterThan(0)

    for (let i = 0; i < 40; i++) {
      sweep(state, { anchor, huberKnee: Number.POSITIVE_INFINITY, omega: 1, samplingStride: 1 })

      const current = measure()

      // Equality is allowed: a converged sweep moves nothing.
      expect(current).toBeLessThanOrEqual(previous * (1 + 1e-12))
      previous = current
    }
  })

  it('actually descends rather than merely not rising', () => {
    const { state, measure } = bench(102)

    const before = measure()

    for (let i = 0; i < 40; i++) {
      sweep(state, { anchor, huberKnee: Number.POSITIVE_INFINITY, omega: 1, samplingStride: 1 })
    }

    expect(measure()).toBeLessThan(before / 2)
  })

  /**
   * Not a convergence rate — a direction. Undamped majorization on a graph this
   * size is slow, and how slow is exactly why the running solver over-relaxes;
   * what has to be true here is that it is heading somewhere and not circling.
   */
  it('settles rather than circling', () => {
    const { state } = bench(103)

    const displacements: number[] = []

    for (let i = 0; i < 120; i++) {
      displacements.push(
        sweep(state, {
          anchor,
          huberKnee: Number.POSITIVE_INFINITY,
          omega: 1,
          samplingStride: 1,
        }).maxDisplacement,
      )
    }

    const early = displacements[10] ?? 0
    const late = displacements[119] ?? 0

    expect(late).toBeLessThan(early / 4)
  })

  /** The over-relaxation earns its place, on the same graph and the same budget. */
  it('gets further in the same number of sweeps when over-relaxed', () => {
    const plain = bench(103)
    const relaxed = bench(103)

    for (let i = 0; i < 30; i++) {
      sweep(plain.state, {
        anchor,
        huberKnee: Number.POSITIVE_INFINITY,
        omega: 1,
        samplingStride: 1,
      })
      sweep(relaxed.state, {
        anchor,
        huberKnee: Number.POSITIVE_INFINITY,
        omega: 1.5,
        samplingStride: 1,
      })
    }

    expect(relaxed.measure()).toBeLessThan(plain.measure())
  })

  it('samples residuals for the scale estimate as it goes', () => {
    const { state } = bench(104)

    const result = sweep(state, { anchor, huberKnee: 2, omega: 1, samplingStride: 4 })

    expect(result.samples.length).toBeGreaterThan(20)
    expect(result.samples.every(sample => Number.isFinite(sample.residual))).toBe(true)
  })

  it('holds a device that nothing measures and nothing anchors', () => {
    const built = buildScenario({ count: 3, seed: 105 })
    const graph = graphOf({ ...built, edges: [] })

    const adjacency = new Adjacency()
    adjacency.rebuildIfStale(graph)

    const positions = new Float64Array(graph.capacity * 3)
    positions[0] = 42

    sweep(
      {
        positions,
        anchors: graph.anchors,
        slots: [0],
        // No reading: the one case where both weights are zero.
        locationAt: () => undefined,
        adjacency,
        scale,
      },
      { anchor, huberKnee: 2, omega: 1, samplingStride: 1 },
    )

    expect(positions[0]).toBe(42)
  })
})
