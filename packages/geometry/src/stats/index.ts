/**
 * The one order statistic the reconstruction depends on.
 *
 * A mean is the obvious summary and the wrong one wherever a sample can contain
 * something that is not noise at all — a reflection, a body in the way, a pair
 * that should never have been measured. One of those moves a mean and does not
 * move a median, which is the whole reason the sensor estimate is built out of
 * medians.
 */
export function median(values: readonly number[]) {
  if (values.length === 0) return 0

  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1

  if (sorted.length % 2 === 1) return sorted[middle] ?? 0

  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}
