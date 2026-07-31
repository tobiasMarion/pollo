import { randomUUID } from 'node:crypto';
import type { Location } from '@pollo/contracts';
import type { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { GraphStore } from './graph-store.js';

const location: Location = {
  latitude: -29.7,
  longitude: -53.7,
  horizontalAccuracy: 5,
  altitude: 100,
  verticalAccuracy: 3,
};

describe('GraphStore', () => {
  let store: GraphStore;

  beforeEach(() => {
    // ioredis-mock instances share one keyspace; a unique graph id isolates tests.
    store = new GraphStore(new RedisMock() as unknown as Redis, randomUUID());
  });

  it('adds and lists nodes', async () => {
    await store.addNode('a');
    await store.addNode('b');

    expect((await store.listNodes()).sort()).toEqual(['a', 'b']);
  });

  it('stores node locations and keeps position when location changes', async () => {
    await store.addNode('a');
    await store.setNodeLocation('a', location);

    const metadata = await store.getNodeMetadata('a');
    expect(metadata?.location).toEqual(location);

    const position = {
      uncorrected: { relative: { x: 0, y: 0, z: 0 }, absolute: { x: 1, y: 1, z: 1 } },
      simulated: { relative: { x: 0, y: 0, z: 0 }, absolute: { x: 1, y: 1, z: 1 } },
    };

    await store.setNodePosition('a', position);
    await store.setNodeLocation('a', { ...location, altitude: 101 });

    const updated = await store.getNodeMetadata('a');
    expect(updated?.position).toEqual(position);
    expect(updated?.location.altitude).toBe(101);
  });

  it('creates edges, implicitly adding their nodes', async () => {
    await store.setEdge({ from: 'a', to: 'b', value: 2.5 });

    expect((await store.listNodes()).sort()).toEqual(['a', 'b']);
    expect(await store.listEdges()).toEqual([{ from: 'a', to: 'b', value: 2.5 }]);
  });

  it('removes edges', async () => {
    await store.setEdge({ from: 'a', to: 'b', value: 2.5 });
    await store.removeEdge('a', 'b');

    expect(await store.listEdges()).toEqual([]);
  });

  it('removing a node also removes edges pointing at it', async () => {
    await store.setEdge({ from: 'a', to: 'b', value: 1 });
    await store.setEdge({ from: 'b', to: 'a', value: 1 });
    await store.setEdge({ from: 'b', to: 'c', value: 2 });

    await store.removeNode('a');

    expect((await store.listNodes()).sort()).toEqual(['b', 'c']);
    expect(await store.listEdges()).toEqual([{ from: 'b', to: 'c', value: 2 }]);
  });

  it('getEventGraph returns nodes with metadata and all edges', async () => {
    await store.addNode('a');
    await store.setNodeLocation('a', location);
    await store.setEdge({ from: 'a', to: 'b', value: 3 });

    const graph = await store.getEventGraph();

    expect(Object.keys(graph.nodes)).toEqual(['a']);
    expect(graph.edges).toEqual([{ from: 'a', to: 'b', value: 3 }]);
  });

  it('deleteGraph wipes everything', async () => {
    await store.addNode('a');
    await store.setNodeLocation('a', location);
    await store.setEdge({ from: 'a', to: 'b', value: 1 });

    await store.deleteGraph();

    expect(await store.listNodes()).toEqual([]);
    expect(await store.listEdges()).toEqual([]);
    expect(await store.getNodeMetadata('a')).toBeNull();
  });
});
