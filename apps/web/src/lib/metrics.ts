import type { Edge } from '@pollo/contracts'
import { vector } from '@pollo/geometry'
import type { DeviceState } from './field-state.svelte'

export interface HistogramBin {
  label: string
  count: number
}

export interface Distribution {
  bins: HistogramBin[]
  mean: number | null
  median: number | null
  p95: number | null
  max: number | null
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((total, value) => total + value, 0) / values.length
}

export interface FieldMetrics {
  deviceCount: number
  placedCount: number
  edgeCount: number
  isolatedCount: number
  componentCount: number
  largestComponent: number
  degrees: Distribution
  corrections: Distribution
  ranges: Distribution
  gpsAccuracy: Distribution
}

const HISTOGRAM_BINS = 7

function percentile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null

  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * q
  const lower = Math.floor(index)
  const upper = Math.ceil(index)

  if (lower === upper) return sorted[lower] ?? null

  const progress = index - lower
  const low = sorted[lower] ?? 0
  const high = sorted[upper] ?? low

  return low + (high - low) * progress
}

function continuousDistribution(values: readonly number[]): Distribution {
  if (values.length === 0) return { bins: [], mean: null, median: null, p95: null, max: null }

  const max = Math.max(...values)
  const width = max === 0 ? 1 : max / HISTOGRAM_BINS
  const bins = Array.from({ length: HISTOGRAM_BINS }, (_, index) => ({
    label: `${formatMeters(index * width)}–${formatMeters((index + 1) * width)}`,
    count: 0,
  }))

  for (const value of values) {
    const index = Math.min(Math.floor(value / width), HISTOGRAM_BINS - 1)
    const bin = bins[index]
    if (bin) bin.count++
  }

  return {
    bins,
    mean: mean(values),
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max,
  }
}

function degreeDistribution(values: readonly number[]): Distribution {
  const bins = Array.from({ length: 7 }, (_, degree) => ({
    label: degree === 6 ? '6+' : String(degree),
    count: 0,
  }))

  for (const value of values) {
    const bin = bins[Math.min(value, bins.length - 1)]
    if (bin) bin.count++
  }

  return {
    bins,
    mean: mean(values),
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length === 0 ? null : Math.max(...values),
  }
}

function components(deviceIds: readonly string[], edges: readonly Edge[]) {
  const neighbours = new Map(deviceIds.map(deviceId => [deviceId, new Set<string>()]))

  for (const { from, to } of edges) {
    neighbours.get(from)?.add(to)
    neighbours.get(to)?.add(from)
  }

  let componentCount = 0
  let largestComponent = 0
  const seen = new Set<string>()

  for (const deviceId of deviceIds) {
    if (seen.has(deviceId)) continue

    componentCount++
    let size = 0
    const pending = [deviceId]
    seen.add(deviceId)

    while (pending.length > 0) {
      const current = pending.pop()
      if (!current) continue
      size++

      for (const neighbour of neighbours.get(current) ?? []) {
        if (!seen.has(neighbour)) {
          seen.add(neighbour)
          pending.push(neighbour)
        }
      }
    }

    largestComponent = Math.max(largestComponent, size)
  }

  return { componentCount, largestComponent, neighbours }
}

/** A present-tense diagnostic view: no history is retained in the browser. */
export function fieldMetrics(
  devices: readonly DeviceState[],
  edges: readonly Edge[],
): FieldMetrics {
  const deviceIds = devices.map(device => device.deviceId)
  const { componentCount, largestComponent, neighbours } = components(deviceIds, edges)
  const corrections = devices.flatMap(device =>
    device.position
      ? [vector.distance(device.position.uncorrected.relative, device.position.simulated.relative)]
      : [],
  )
  const ranges = edges.map(edge => edge.value)
  const gpsAccuracy = devices.flatMap(device =>
    device.location ? [device.location.horizontalAccuracy] : [],
  )

  return {
    deviceCount: devices.length,
    placedCount: devices.filter(device => device.position !== null).length,
    edgeCount: edges.length,
    isolatedCount: devices.filter(device => (neighbours.get(device.deviceId)?.size ?? 0) === 0)
      .length,
    componentCount,
    largestComponent,
    degrees: degreeDistribution(devices.map(device => neighbours.get(device.deviceId)?.size ?? 0)),
    corrections: continuousDistribution(corrections),
    ranges: continuousDistribution(ranges),
    gpsAccuracy: continuousDistribution(gpsAccuracy),
  }
}

export function formatMeters(value: number | null, digits = 1): string {
  if (value === null) return '—'
  if (value >= 1_000) return `${(value / 1_000).toFixed(digits)} km`
  return `${value.toFixed(digits)} m`
}
