import type { IngestMessage, Location } from '@pollo/contracts'
import { describe, expect, it } from 'vitest'
import { EventGraph } from './index.js'

const origin = { latitude: -29.6842, longitude: -53.8069 }

function location(partial: Partial<Location> = {}): Location {
  return {
    latitude: origin.latitude,
    longitude: origin.longitude,
    altitude: 100,
    horizontalAccuracy: 5,
    verticalAccuracy: 12,
    ...partial,
  }
}

function join(deviceId: string, at: Partial<Location> = {}): IngestMessage {
  return { op: 'JOIN', deviceId, location: location(at) }
}

function distance(from: string, to: string, value: number | null): IngestMessage {
  return { op: 'DISTANCE', from, to, distance: value }
}

describe('EventGraph', () => {
  it('places a device at its own GPS, in the field frame', () => {
    const graph = new EventGraph(origin)

    graph.apply(join('a', { latitude: origin.latitude + 0.001, altitude: 117 }))

    const slot = graph.slotOf('a')
    expect(slot).toBeDefined()

    const anchor = graph.anchorAt(slot ?? 0)

    expect(anchor.x).toBeCloseTo(0, 6)
    expect(anchor.y).toBeCloseTo(110.574, 3)
    expect(anchor.z).toBe(117)
  })

  it('counts a device once however many times it reports', () => {
    const graph = new EventGraph(origin)

    graph.applyBatch([
      join('a'),
      { op: 'LOCATION_UPDATE', deviceId: 'a', location: location({ altitude: 105 }) },
    ])

    expect(graph.size).toBe(1)
    expect(graph.anchorAt(graph.slotOf('a') ?? 0).z).toBe(105)
  })

  /**
   * A worker that starts mid-event missed every `JOIN` the crowd ever sent. If a
   * report from an unknown device were ignored, it would stay blind to that
   * device until it reconnected — which, for a phone that is standing there
   * working perfectly, is never.
   */
  it('treats a report from a device it has never seen as an arrival', () => {
    const graph = new EventGraph(origin)

    graph.apply({ op: 'LOCATION_UPDATE', deviceId: 'late', location: location() })

    expect(graph.size).toBe(1)
    expect(graph.slotOf('late')).toBeDefined()
  })

  it('keeps the two directions of a pair apart', () => {
    const graph = new EventGraph(origin)

    graph.applyBatch([join('a'), join('b'), distance('a', 'b', 3)])

    expect(graph.degreeOf(graph.slotOf('a') ?? 0)).toBe(1)
    expect(graph.degreeOf(graph.slotOf('b') ?? 0)).toBe(0)
  })

  it('drops an edge on a null distance rather than storing a zero', () => {
    const graph = new EventGraph(origin)

    graph.applyBatch([join('a'), join('b'), distance('a', 'b', 3), distance('a', 'b', null)])

    expect(graph.degreeOf(graph.slotOf('a') ?? 0)).toBe(0)
  })

  it('ignores a distance naming a device it does not hold', () => {
    const graph = new EventGraph(origin)

    graph.applyBatch([join('a'), distance('a', 'ghost', 3), distance('ghost', 'a', 3)])

    expect(graph.degreeOf(graph.slotOf('a') ?? 0)).toBe(0)
    expect(graph.size).toBe(1)
  })

  it('removes the edges that name a departing device, in both directions', () => {
    const graph = new EventGraph(origin)

    graph.applyBatch([
      join('a'),
      join('b'),
      join('c'),
      distance('a', 'b', 3),
      distance('b', 'a', 3),
      distance('c', 'b', 4),
    ])

    graph.apply({ op: 'LEAVE', deviceId: 'b' })

    expect(graph.size).toBe(2)
    expect(graph.degreeOf(graph.slotOf('a') ?? 0)).toBe(0)
    expect(graph.degreeOf(graph.slotOf('c') ?? 0)).toBe(0)
  })

  it('hands a departed slot to the next arrival', () => {
    const graph = new EventGraph(origin)

    graph.apply(join('a'))
    const reused = graph.slotOf('a')

    graph.apply({ op: 'LEAVE', deviceId: 'a' })
    graph.apply(join('b'))

    expect(graph.slotOf('b')).toBe(reused)
    expect(graph.capacity).toBe(1)
    expect(graph.deviceAt(reused ?? 0)).toBe('b')
  })

  it('reports a freed slot exactly once', () => {
    const graph = new EventGraph(origin)

    graph.applyBatch([join('a'), { op: 'LEAVE', deviceId: 'a' }])

    expect(graph.drainReleased()).toEqual([0])
    expect(graph.drainReleased()).toEqual([])
  })

  it('ignores a device measuring itself', () => {
    const graph = new EventGraph(origin)

    graph.applyBatch([join('a'), distance('a', 'a', 0)])

    expect(graph.degreeOf(graph.slotOf('a') ?? 0)).toBe(0)
  })

  it('survives more arrivals than it was sized for', () => {
    const graph = new EventGraph(origin)

    for (let i = 0; i < 1_000; i++) graph.apply(join(`device-${i}`))

    expect(graph.size).toBe(1_000)
    expect(graph.anchorAt(graph.slotOf('device-999') ?? 0).z).toBe(100)
  })
})
