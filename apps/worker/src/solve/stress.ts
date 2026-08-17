import type { Location } from '@pollo/contracts'
import type { Adjacency } from './adjacency.js'
import type { Scale } from './scale.js'
import { type AnchorOptions, anchorWeights, edgeWeight } from './weights.js'

export interface StressState {
  positions: Float64Array
  anchors: Readonly<Float64Array>
  slots: readonly number[]
  locationAt: (slot: number) => Location | undefined
  adjacency: Adjacency
  scale: Scale
  anchor: AnchorOptions
}

/**
 * The number the sweep is trying to make small.
 *
 * Nothing in the running worker needs this — the sweep never evaluates its own
 * objective, which is exactly what makes majorization cheap. It exists to be
 * asserted against: the whole claim of the Guttman step is that this cannot go
 * up, and a claim nothing checks is a comment.
 *
 * Each pair is counted once here while the sweep visits it from both ends, so
 * the value is the objective itself rather than twice it. The factor is
 * constant, so it makes no difference to whether it decreased — but a stress
 * that silently double-counts is a number nobody can compare to anything.
 */
export function stress(state: StressState) {
  let total = 0

  for (const slot of state.slots) {
    const base = slot * 3
    const location = state.locationAt(slot)

    if (!location) continue

    const weights = anchorWeights(location, state.anchor)

    const dx = (state.positions[base] ?? 0) - (state.anchors[base] ?? 0)
    const dy = (state.positions[base + 1] ?? 0) - (state.anchors[base + 1] ?? 0)
    const dz = (state.positions[base + 2] ?? 0) - (state.anchors[base + 2] ?? 0)

    total += weights.horizontal * (dx * dx + dy * dy) + weights.vertical * (dz * dz)
  }

  for (const slot of state.slots) {
    const base = slot * 3
    const from = state.adjacency.offsets[slot] ?? 0
    const to = state.adjacency.offsets[slot + 1] ?? 0

    for (let edge = from; edge < to; edge++) {
      const neighbour = state.adjacency.neighbour[edge] ?? 0

      // Every measurement sits in both endpoints' spans, because the sweep
      // needs it from either side. Keeping only the copy filed under the lower
      // slot counts each *measurement* once — so a pair both devices ranged
      // still contributes two residuals, which is what two observations of one
      // distance are worth.
      if (neighbour <= slot) continue

      const other = neighbour * 3
      const measured = state.adjacency.distance[edge] ?? 0

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
