import { describe, expect, it } from 'vitest'
import { fieldMetrics } from './metrics'

const location = {
  latitude: -29.7,
  longitude: -53.7,
  altitude: 100,
  horizontalAccuracy: 4,
  verticalAccuracy: 8,
}

function device(deviceId: string, corrected = false) {
  return {
    deviceId,
    location,
    position: corrected
      ? {
          uncorrected: { relative: { x: 0, y: 0, z: 0 }, absolute: { x: 0, y: 0, z: 0 } },
          simulated: { relative: { x: 3, y: 4, z: 0 }, absolute: { x: 0, y: 0, z: 0 } },
        }
      : null,
    previousLocation: null,
    previousPosition: null,
    changedAt: 0,
    window: 0,
  }
}

describe('fieldMetrics', () => {
  it('describes the current graph, correction and GPS data without retaining history', () => {
    const metrics = fieldMetrics(
      [device('a', true), device('b'), device('c')],
      [{ from: 'a', to: 'b', value: 12 }],
    )

    expect(metrics).toMatchObject({
      deviceCount: 3,
      placedCount: 1,
      edgeCount: 1,
      isolatedCount: 1,
      componentCount: 2,
      largestComponent: 2,
    })
    expect(metrics.degrees.bins.slice(0, 2).map(bin => bin.count)).toEqual([1, 2])
    expect(metrics.degrees.mean).toBeCloseTo(2 / 3)
    expect(metrics.corrections.median).toBe(5)
    expect(metrics.ranges.max).toBe(12)
    expect(metrics.gpsAccuracy.median).toBe(4)
  })
})
