import type { Csr } from '../csr/index.js'
import type { Scale } from '../sigma/index.js'
import { edgeWeight } from '../weights/index.js'

/**
 * Everything the objective is a function of.
 *
 * Flat arrays indexed by slot, and nothing else: no ids, no readings, no notion
 * of a device. `anchorWeights` holds two numbers per slot — horizontal, then
 * vertical — and a slot with no reading behind it holds two zeros, which is what
 * "nothing pins this point" means without a special case to carry it.
 */
export interface MdsState {
  /** Current estimate, three per slot. */
  positions: Float64Array
  /** Where each point is independently believed to be, three per slot. */
  anchors: Readonly<Float64Array>
  /** Horizontal and vertical anchor weight, two per slot. */
  anchorWeights: Readonly<Float64Array>
  /** Live slots, in the order they should be visited. */
  slots: readonly number[]
  graph: Csr
  scale: Scale
}

/**
 * The number the sweep is trying to make small.
 *
 * Nothing in a running solver needs this — the sweep never evaluates its own
 * objective, which is exactly what makes majorization cheap. It exists to be
 * asserted against: the whole claim of the Guttman step is that this cannot go
 * up, and a claim nothing checks is a comment.
 *
 * Each pair is counted once here while the sweep visits it from both ends, so
 * the value is the objective itself rather than twice it. The factor is
 * constant, so it makes no difference to whether it decreased — but a stress
 * that silently double-counts is a number nobody can compare to anything.
 */
export function stress(state: MdsState) {
  let total = 0

  for (const slot of state.slots) {
    const base = slot * 3
    const weights = slot * 2

    const dx = (state.positions[base] ?? 0) - (state.anchors[base] ?? 0)
    const dy = (state.positions[base + 1] ?? 0) - (state.anchors[base + 1] ?? 0)
    const dz = (state.positions[base + 2] ?? 0) - (state.anchors[base + 2] ?? 0)

    total +=
      (state.anchorWeights[weights] ?? 0) * (dx * dx + dy * dy) +
      (state.anchorWeights[weights + 1] ?? 0) * (dz * dz)
  }

  for (const slot of state.slots) {
    const base = slot * 3
    const from = state.graph.offsets[slot] ?? 0
    const to = state.graph.offsets[slot + 1] ?? 0

    for (let edge = from; edge < to; edge++) {
      const neighbour = state.graph.neighbour[edge] ?? 0

      // Every measurement sits in both endpoints' spans, because the sweep
      // needs it from either side. Keeping only the copy filed under the lower
      // slot counts each *measurement* once — so a pair both devices ranged
      // still contributes two residuals, which is what two observations of one
      // distance are worth.
      if (neighbour <= slot) continue

      const other = neighbour * 3
      const measured = state.graph.distance[edge] ?? 0

      const deltaX = (state.positions[base] ?? 0) - (state.positions[other] ?? 0)
      const deltaY = (state.positions[base + 1] ?? 0) - (state.positions[other + 1] ?? 0)
      const deltaZ = (state.positions[base + 2] ?? 0) - (state.positions[other + 2] ?? 0)

      const norm = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ)
      const residual = norm - measured

      total += edgeWeight(measured, state.scale) * residual * residual
    }
  }

  return total
}
