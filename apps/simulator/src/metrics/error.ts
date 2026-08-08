import { alignClouds, applyAlignment } from './align.js'

export interface ErrorSummary {
  /** How many devices the summary is over. */
  count: number
  mean: number
  p50: number
  p95: number
  max: number
  rmse: number
}

export const EMPTY_SUMMARY: ErrorSummary = { count: 0, mean: 0, p50: 0, p95: 0, max: 0, rmse: 0 }

export interface CloudComparison {
  /** Distances as they stand, in the event's own frame. */
  raw: ErrorSummary
  /**
   * Distances after the best rigid motion has been taken out — the part of the
   * error that is actually about shape.
   */
  aligned: ErrorSummary
}

export const EMPTY_COMPARISON: CloudComparison = { raw: EMPTY_SUMMARY, aligned: EMPTY_SUMMARY }

function summarize(distances: Float64Array, count: number): ErrorSummary {
  if (count === 0) return EMPTY_SUMMARY

  const sorted = distances.subarray(0, count).slice().sort()

  let total = 0
  let squares = 0

  for (let i = 0; i < count; i++) {
    const value = distances[i] ?? 0
    total += value
    squares += value * value
  }

  const at = (quantile: number) => sorted[Math.min(count - 1, Math.floor(count * quantile))] ?? 0

  return {
    count,
    mean: total / count,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[count - 1] ?? 0,
    rmse: Math.sqrt(squares / count),
  }
}

/**
 * Before and after alignment. The gap between the two is the rigid misalignment
 * — a missing anchor rather than a bad solver.
 */
export function compareClouds(
  estimate: Float32Array,
  truth: Float32Array,
  count: number,
): CloudComparison {
  if (count === 0) return EMPTY_COMPARISON

  const raw = new Float64Array(count)
  const aligned = new Float64Array(count)

  const alignment = alignClouds(estimate, truth, count)

  for (let i = 0; i < count; i++) {
    const point = {
      x: estimate[i * 3] ?? 0,
      y: estimate[i * 3 + 1] ?? 0,
      z: estimate[i * 3 + 2] ?? 0,
    }

    const target = {
      x: truth[i * 3] ?? 0,
      y: truth[i * 3 + 1] ?? 0,
      z: truth[i * 3 + 2] ?? 0,
    }

    raw[i] = Math.hypot(point.x - target.x, point.y - target.y, point.z - target.z)

    const moved = applyAlignment(alignment, point)
    aligned[i] = Math.hypot(moved.x - target.x, moved.y - target.y, moved.z - target.z)
  }

  return { raw: summarize(raw, count), aligned: summarize(aligned, count) }
}
