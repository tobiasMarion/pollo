import type { Vector3 } from '@pollo/contracts'
import { describe, expect, it } from 'vitest'
import { chooseNeighbors } from './neighbor-choice.js'

const at = (x: number, y: number, z = 0) => ({ x, y, z })

function field(points: Record<string, Vector3>) {
  return {
    candidates: Object.keys(points),
    pointOf: (deviceId: string) => points[deviceId],
  }
}

describe('chooseNeighbors', () => {
  it('never suggests a device to itself', () => {
    const peers = chooseNeighbors({
      deviceId: 'me',
      point: at(0, 0),
      ...field({ me: at(0, 0) }),
      degree: 4,
      radius: 10,
    })

    expect(peers).toEqual([])
  })

  it('takes the nearest peer in each direction', () => {
    const peers = chooseNeighbors({
      deviceId: 'me',
      point: at(0, 0),
      ...field({
        near: at(2, 0.1),
        far: at(6, 0.1),
        behind: at(-3, -0.1),
      }),
      degree: 4,
      radius: 10,
    })

    expect(peers).toEqual(['near', 'behind'])
  })

  it('prefers spread over proximity', () => {
    // Three peers to the east, one to the west and further away. Taking the
    // closest four would return the eastern cluster and nothing else, and a
    // position pulled on from one side only is barely pinned down at all.
    const peers = chooseNeighbors({
      deviceId: 'me',
      point: at(0, 0),
      ...field({
        east1: at(1, 0),
        east2: at(2, 0),
        east3: at(3, 0),
        west: at(-9, 0),
      }),
      degree: 4,
      radius: 10,
    })

    expect(peers).toEqual(['east1', 'west'])
  })

  it('leaves a direction empty rather than filling it from another', () => {
    const points: Record<string, Vector3> = {}

    // Everybody due north: a device at the edge of a crowd, with the field on
    // one side of it and nothing on the other.
    for (let i = 1; i <= 20; i++) points[`north${i}`] = at(0.001 * i, i * 0.4)

    const peers = chooseNeighbors({
      deviceId: 'me',
      point: at(0, 0),
      ...field(points),
      degree: 8,
      radius: 10,
    })

    expect(peers).toEqual(['north1'])
  })

  it('measures distance in three dimensions', () => {
    // Same spot on the plan, one on the balcony and one further up still.
    const peers = chooseNeighbors({
      deviceId: 'me',
      point: at(0, 0, 0),
      ...field({ balcony: at(1, 0, 4), sky: at(1, 0, 12) }),
      degree: 4,
      radius: 10,
    })

    expect(peers).toEqual(['balcony'])
  })

  it('skips candidates that have since left', () => {
    const peers = chooseNeighbors({
      deviceId: 'me',
      point: at(0, 0),
      candidates: ['gone', 'here'],
      pointOf: deviceId => (deviceId === 'here' ? at(1, 0) : undefined),
      degree: 4,
      radius: 10,
    })

    expect(peers).toEqual(['here'])
  })

  it('returns the same list for the same neighbourhood, whatever order it is walked in', () => {
    const points = {
      north: at(0, 3),
      east: at(3, 0),
      south: at(0, -3),
      west: at(-3, 0),
    }

    const forwards = chooseNeighbors({
      deviceId: 'me',
      point: at(0, 0),
      candidates: Object.keys(points),
      pointOf: (deviceId: string) => points[deviceId as keyof typeof points],
      degree: 4,
      radius: 10,
    })

    const backwards = chooseNeighbors({
      deviceId: 'me',
      point: at(0, 0),
      candidates: Object.keys(points).reverse(),
      pointOf: (deviceId: string) => points[deviceId as keyof typeof points],
      degree: 4,
      radius: 10,
    })

    expect(forwards).toEqual(['east', 'north', 'west', 'south'])
    expect(backwards).toEqual(forwards)
  })

  it('asks for nobody when asked for nobody', () => {
    const peers = chooseNeighbors({
      deviceId: 'me',
      point: at(0, 0),
      ...field({ other: at(1, 0) }),
      degree: 0,
      radius: 10,
    })

    expect(peers).toEqual([])
  })
})
