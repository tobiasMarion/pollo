import { randomUUID } from 'node:crypto'
import type { Location } from '@pollo/contracts'
import type { Redis } from 'ioredis'
import RedisMock from 'ioredis-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import type { EdgeChange, GraphBatch } from '../batching/graph-writer.js'
import { GraphStore } from './graph-store.js'

const location: Location = {
  latitude: -29.7,
  longitude: -53.7,
  horizontalAccuracy: 5,
  altitude: 100,
  verticalAccuracy: 3,
}

const position = {
  uncorrected: { relative: { x: 0, y: 0, z: 0 }, absolute: { x: 1, y: 1, z: 1 } },
  simulated: { relative: { x: 0, y: 0, z: 0 }, absolute: { x: 1, y: 1, z: 1 } },
}

function batch(partial: Partial<GraphBatch> = {}): GraphBatch {
  return { removed: [], added: [], locations: [], edges: [], ...partial }
}

const edge = (from: string, to: string, distance: number | null): EdgeChange => ({
  from,
  to,
  distance,
})

describe('GraphStore', () => {
  let store: GraphStore

  beforeEach(() => {
    // ioredis-mock instances share one keyspace; a unique graph id isolates tests.
    store = new GraphStore(new RedisMock() as unknown as Redis, randomUUID())
  })

  it('adds and lists nodes', async () => {
    await store.applyBatch(batch({ added: ['a', 'b'] }))

    expect((await store.listNodes()).sort()).toEqual(['a', 'b'])
  })

  it('writes a location without reading the position back', async () => {
    await store.applyBatch(batch({ added: ['a'], locations: [['a', location]] }))
    await store.setNodePosition('a', position)

    // The whole reason the two live in separate hashes: this used to be a read,
    // a merge and a write, on every reading from every device.
    await store.applyBatch(batch({ locations: [['a', { ...location, altitude: 101 }]] }))

    const metadata = await store.getNodeMetadata('a')

    expect(metadata?.position).toEqual(position)
    expect(metadata?.location.altitude).toBe(101)
  })

  it('does not invent nodes for the ends of an edge', async () => {
    // setEdge used to add both endpoints, which is how a device that had already
    // left came back as a node nothing would ever sweep again. A node exists
    // because somebody joined, and edges are read through the node set.
    await store.applyBatch(batch({ edges: [edge('a', 'b', 2.5)] }))

    expect(await store.listNodes()).toEqual([])
    expect(await store.listEdges()).toEqual([])
  })

  it('drops an edge reported as null', async () => {
    await store.applyBatch(batch({ added: ['a'], edges: [edge('a', 'b', 2.5)] }))

    expect(await store.listEdges()).toEqual([{ from: 'a', to: 'b', value: 2.5 }])

    await store.applyBatch(batch({ edges: [edge('a', 'b', null)] }))

    expect(await store.listEdges()).toEqual([])
  })

  it('removes the edges pointing at a departed node without reading the graph', async () => {
    await store.applyBatch(
      batch({
        added: ['a', 'b', 'c'],
        edges: [edge('a', 'b', 1), edge('b', 'a', 1), edge('b', 'c', 2)],
      }),
    )

    await store.applyBatch(batch({ removed: ['a'] }))

    expect((await store.listNodes()).sort()).toEqual(['b', 'c'])
    expect(await store.listEdges()).toEqual([{ from: 'b', to: 'c', value: 2 }])
  })

  it('leaves nothing behind in the reverse index when a node goes', async () => {
    await store.applyBatch(batch({ added: ['a', 'b'], edges: [edge('a', 'b', 1)] }))
    await store.applyBatch(batch({ removed: ['b'] }))

    // `a` is still here and still measuring nobody. If the reverse set outlived
    // `b`, re-adding `b` later would resurrect an edge nobody reported.
    await store.applyBatch(batch({ added: ['b'] }))

    expect(await store.listEdges()).toEqual([])
  })

  it('applies removals before additions, so a rejoin survives the batch', async () => {
    await store.applyBatch(batch({ added: ['a'], locations: [['a', location]] }))
    await store.applyBatch(batch({ removed: ['a'], added: ['a'], locations: [['a', location]] }))

    expect(await store.listNodes()).toEqual(['a'])
    expect((await store.getNodeMetadata('a'))?.location).toEqual(location)
  })

  it('getEventGraph returns nodes with metadata and all edges', async () => {
    await store.applyBatch(
      batch({ added: ['a'], locations: [['a', location]], edges: [edge('a', 'b', 3)] }),
    )

    const graph = await store.getEventGraph()

    expect(Object.keys(graph.nodes)).toEqual(['a'])
    expect(graph.edges).toEqual([{ from: 'a', to: 'b', value: 3 }])
  })

  it('deleteGraph wipes everything', async () => {
    await store.applyBatch(
      batch({ added: ['a'], locations: [['a', location]], edges: [edge('a', 'b', 1)] }),
    )

    await store.deleteGraph()

    expect(await store.listNodes()).toEqual([])
    expect(await store.listEdges()).toEqual([])
    expect(await store.getNodeMetadata('a')).toBeNull()
  })
})
