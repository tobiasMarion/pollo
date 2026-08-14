import type { Location } from '@pollo/contracts'
import { describe, expect, it } from 'vitest'
import { GraphWriter } from './graph-writer.js'

const at = (altitude: number): Location => ({
  latitude: -29.7,
  longitude: -53.7,
  horizontalAccuracy: 5,
  altitude,
  verticalAccuracy: 3,
})

describe('GraphWriter', () => {
  it('collapses a burst from one device into its latest reading', () => {
    const writer = new GraphWriter()

    writer.joined('a', at(100))
    writer.locationChanged('a', at(101))
    writer.locationChanged('a', at(102))

    const batch = writer.take()

    expect(batch.locations).toEqual([['a', at(102)]])
    expect(batch.added).toEqual(['a'])
  })

  it('collapses repeated measurements of one pair', () => {
    const writer = new GraphWriter()

    writer.edgeChanged('a', 'b', 1)
    writer.edgeChanged('a', 'b', 2)
    writer.edgeChanged('b', 'a', 3)

    expect(writer.take().edges).toEqual([
      { from: 'a', to: 'b', distance: 2 },
      { from: 'b', to: 'a', distance: 3 },
    ])
  })

  it('leaves nothing behind for a device that arrived and left in one window', () => {
    const writer = new GraphWriter()

    writer.joined('a', at(100))
    writer.edgeChanged('a', 'b', 1)
    writer.departed('a')

    // It was never written, so deleting it would be the only trace it ever left.
    expect(writer.empty).toBe(true)
  })

  it('queues a removal for a device that was already written', () => {
    const writer = new GraphWriter()

    writer.joined('a', at(100))
    writer.take()

    writer.departed('a')

    expect(writer.take()).toMatchObject({ removed: ['a'], added: [], locations: [] })
  })

  it('drops queued edges in both directions when a device goes', () => {
    const writer = new GraphWriter()

    writer.joined('a', at(100))
    writer.joined('b', at(100))
    writer.take()

    writer.edgeChanged('a', 'b', 1)
    writer.edgeChanged('b', 'a', 1)
    writer.edgeChanged('b', 'c', 2)
    writer.departed('a')

    expect(writer.take().edges).toEqual([{ from: 'b', to: 'c', distance: 2 }])
  })

  it('puts a removal before the rejoin that follows it', () => {
    const writer = new GraphWriter()

    writer.joined('a', at(100))
    writer.take()

    writer.departed('a')
    writer.joined('a', at(101))

    const batch = writer.take()

    // Applied the other way round, the rejoin would be undone by the removal —
    // and applied without the removal, the old edges would outlive the device.
    expect(batch.removed).toEqual(['a'])
    expect(batch.added).toEqual(['a'])
    expect(batch.locations).toEqual([['a', at(101)]])
  })

  it('counts what is waiting, and starts over once it is taken', () => {
    const writer = new GraphWriter()

    writer.joined('a', at(100))
    writer.edgeChanged('a', 'b', 1)

    expect(writer.pending).toBe(3)

    writer.take()

    expect(writer.pending).toBe(0)
    expect(writer.empty).toBe(true)
  })

  it('throws the queue away for a graph that is about to be deleted', () => {
    const writer = new GraphWriter()

    writer.joined('a', at(100))
    writer.discard()

    expect(writer.empty).toBe(true)
  })
})
