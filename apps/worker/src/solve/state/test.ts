import { describe, expect, it } from 'vitest'
import { SolverState } from './index.js'

describe('SolverState', () => {
  /**
   * A newcomer starts on its own reading, in both layers. Not at the origin and
   * not at the centroid: a reconstruction from distances is invariant to
   * reflection, so where a device starts decides which mirror image it finds.
   */
  it('starts a slot on its anchor, in both layers at once', () => {
    const state = new SolverState()
    const anchors = Float64Array.from([0, 0, 0, 7, -3, 12])

    expect(state.isPlaced(1)).toBe(false)

    state.start(1, anchors)

    expect(state.isPlaced(1)).toBe(true)
    expect(state.at(1)).toEqual({ x: 7, y: -3, z: 12 })
    expect([...state.working.subarray(3, 6)]).toEqual([7, -3, 12])
  })

  it('moves the published answer a fraction of the way to the working one', () => {
    const state = new SolverState()

    state.start(0, Float64Array.from([0, 0, 0]))
    state.working.set([10, 20, -40])

    state.absorb(0, 0.25)

    expect(state.at(0)).toEqual({ x: 2.5, y: 5, z: -10 })
  })

  it('adopts the working answer whole at a step of one', () => {
    const state = new SolverState()

    state.start(0, Float64Array.from([0, 0, 0]))
    state.working.set([1, 2, 3])
    state.absorb(0, 1)

    expect(state.at(0)).toEqual({ x: 1, y: 2, z: 3 })
  })

  /** A slot handed to a newcomer must arrive carrying none of its last tenant's state. */
  it('forgets a released slot', () => {
    const state = new SolverState()

    state.start(0, Float64Array.from([5, 5, 5]))
    state.setAnchorWeights(0, 0.04, 0.01)
    state.release(0)

    expect(state.isPlaced(0)).toBe(false)
    expect([...state.anchorWeights.subarray(0, 2)]).toEqual([0, 0])
  })

  it('keeps the two anchor axes on their own weights', () => {
    const state = new SolverState()

    state.setAnchorWeights(2, 0.04, 0.007)

    expect(state.anchorWeights[4]).toBeCloseTo(0.04, 12)
    expect(state.anchorWeights[5]).toBeCloseTo(0.007, 12)
  })

  it('grows without losing anything already written', () => {
    const state = new SolverState()

    state.start(0, Float64Array.from([1, 2, 3]))
    state.setAnchorWeights(0, 0.5, 0.25)

    state.reserve(4_000)

    expect(state.at(0)).toEqual({ x: 1, y: 2, z: 3 })
    expect(state.isPlaced(0)).toBe(true)
    expect(state.anchorWeights[0]).toBe(0.5)
    expect(state.placed.length).toBeGreaterThanOrEqual(4_000)
    expect(state.published.length).toBe(state.placed.length * 3)
    expect(state.anchorWeights.length).toBe(state.placed.length * 2)
  })
})
