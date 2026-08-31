import { describe, expect, it } from 'vitest'
import { csrOf, type Edge } from '../fixtures/index.js'
import { edgeWeight } from '../weights/index.js'
import { stress } from './index.js'

const scale = { floor: 1, relative: 0 }

function stateOf(
  positions: number[],
  anchors: number[],
  anchorWeights: number[],
  edges: readonly Edge[],
) {
  const count = positions.length / 3

  return {
    positions: Float64Array.from(positions),
    anchors: Float64Array.from(anchors),
    anchorWeights: Float64Array.from(anchorWeights),
    slots: Array.from({ length: count }, (_, slot) => slot),
    graph: csrOf(count, edges),
    scale,
  }
}

describe('stress', () => {
  it('is zero for a layout that satisfies everything asked of it', () => {
    const state = stateOf(
      [0, 0, 0, 3, 0, 0, 0, 4, 0],
      [0, 0, 0, 3, 0, 0, 0, 4, 0],
      [1, 1, 1, 1, 1, 1],
      [
        [0, 1, 3],
        [1, 2, 5],
        [0, 2, 4],
      ],
    )

    expect(stress(state)).toBeCloseTo(0, 12)
  })

  /** Three nodes, one edge and one anchor off its mark, worked out by hand. */
  it('adds the anchor springs to the distance springs', () => {
    const state = stateOf(
      [0, 0, 0, 3, 0, 0, 0, 0, 0],
      [0, 2, 0, 3, 0, 0, 0, 0, 0],
      [0.5, 0.25, 0, 0, 0, 0],
      [[0, 1, 5] as Edge],
    )

    // Slot 0 is two metres north of its anchor, at a horizontal weight of a half:
    // 0.5 · 2² = 2. The measured five metres against a gap of three leaves a
    // residual of −2, weighted by one over sigma squared, which is one here.
    expect(stress(state)).toBeCloseTo(2 + 4, 12)
  })

  it('counts the vertical axis on its own weight', () => {
    const state = stateOf([0, 0, 3], [0, 0, 0], [7, 0.5], [])

    expect(stress(state)).toBeCloseTo(0.5 * 9, 12)
  })

  /**
   * A pair sits in both endpoints' spans because the sweep needs it from either
   * side. Counting it once here makes the number the objective rather than twice
   * it — and a pair both devices ranged still contributes two residuals, because
   * two observations of one distance are worth two.
   */
  it('counts each measurement once, and a pair measured twice twice', () => {
    const once = stateOf([0, 0, 0, 3, 0, 0], [0, 0, 0, 3, 0, 0], [0, 0, 0, 0], [[0, 1, 5] as Edge])

    const both = stateOf(
      [0, 0, 0, 3, 0, 0],
      [0, 0, 0, 3, 0, 0],
      [0, 0, 0, 0],
      [
        [0, 1, 5],
        [1, 0, 5],
      ],
    )

    expect(stress(once)).toBeCloseTo(edgeWeight(5, scale) * 4, 12)
    expect(stress(both)).toBeCloseTo(stress(once) * 2, 12)
  })

  /** Two zeros is how "nothing pins this point" is said, without a special case. */
  it('ignores a point with no anchor weight behind it', () => {
    const unpinned = stateOf([9, 9, 9], [0, 0, 0], [0, 0], [])

    expect(stress(unpinned)).toBe(0)
  })
})
