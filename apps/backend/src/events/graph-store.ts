import {
  type Edge,
  type Location,
  type Metadata,
  metadataSchema,
  type Node,
  type NodePosition,
  type NodesWithMetadata,
} from '@pollo/contracts';
import type { Redis } from 'ioredis';

const TTL_SECONDS = 43_200; // 12 hours

/**
 * Persists the distance graph of an event in Redis: a set of nodes, a hash of
 * edges per node and a metadata hash (location + last known position). Serves
 * REST reads and worker hydration; every key carries a TTL so abandoned
 * events evaporate on their own.
 */
export class GraphStore {
  constructor(
    private readonly redis: Redis,
    private readonly graphId: string,
  ) {}

  private keyForNode(node: Node) {
    return `graph:${this.graphId}:edges:${node}`;
  }

  private keyForNodesSet() {
    return `graph:${this.graphId}:nodes`;
  }

  private keyForNodeMetadata() {
    return `graph:${this.graphId}:node_metadata`;
  }

  async addNode(node: Node) {
    const key = this.keyForNodesSet();
    await this.redis.sadd(key, node);
    await this.redis.expire(key, TTL_SECONDS);
  }

  async setNodeLocation(node: Node, location: Location) {
    const existing = await this.getNodeMetadata(node);
    const updated: Metadata = { location, position: existing?.position };

    const key = this.keyForNodeMetadata();
    await this.redis.hset(key, node, JSON.stringify(updated));
    await this.redis.expire(key, TTL_SECONDS);
  }

  async setNodePosition(node: Node, position: NodePosition) {
    const existing = await this.getNodeMetadata(node);
    if (!existing) return;

    const updated: Metadata = { location: existing.location, position };

    const key = this.keyForNodeMetadata();
    await this.redis.hset(key, node, JSON.stringify(updated));
    await this.redis.expire(key, TTL_SECONDS);
  }

  async getNodeMetadata(node: Node): Promise<Metadata | null> {
    const json = await this.redis.hget(this.keyForNodeMetadata(), node);
    if (!json) return null;

    const parsed = metadataSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  }

  async listNodesMetadata(): Promise<NodesWithMetadata> {
    const nodes = await this.listNodes();
    const pipeline = this.redis.pipeline();

    for (const node of nodes) {
      pipeline.hget(this.keyForNodeMetadata(), node);
    }

    const results = await pipeline.exec();

    if (!results) {
      throw new Error('Failed to execute Redis pipeline');
    }

    const metadataMap: NodesWithMetadata = {};

    for (let i = 0; i < results.length; i++) {
      const [error, json] = results[i] ?? [];
      const node = nodes[i];
      if (error || typeof json !== 'string' || node === undefined) continue;

      const parsed = metadataSchema.safeParse(JSON.parse(json));
      if (parsed.success) {
        metadataMap[node] = parsed.data;
      }
    }

    return metadataMap;
  }

  async setEdge({ from, to, value }: Edge) {
    await this.addNode(from);
    await this.addNode(to);

    const key = this.keyForNode(from);
    await this.redis.hset(key, to, value);
    await this.redis.expire(key, TTL_SECONDS);
  }

  async removeEdge(from: Node, to: Node) {
    await this.redis.hdel(this.keyForNode(from), to);
  }

  async listNodes() {
    return await this.redis.smembers(this.keyForNodesSet());
  }

  async removeNode(node: Node) {
    const allNodes = await this.listNodes();
    const pipeline = this.redis.pipeline();

    pipeline.srem(this.keyForNodesSet(), node);

    for (const otherNode of allNodes) {
      pipeline.hdel(this.keyForNode(otherNode), node);
    }

    pipeline.del(this.keyForNode(node));
    pipeline.hdel(this.keyForNodeMetadata(), node);

    await pipeline.exec();
  }

  async deleteGraph() {
    const nodes = await this.listNodes();
    const keys = nodes.map((node) => this.keyForNode(node));
    keys.push(this.keyForNodesSet(), this.keyForNodeMetadata());

    await this.redis.del(...keys);
  }

  async listEdges(): Promise<Edge[]> {
    const nodes = await this.listNodes();
    const pipeline = this.redis.pipeline();

    for (const from of nodes) {
      pipeline.hgetall(this.keyForNode(from));
    }

    const results = await pipeline.exec();

    if (!results) {
      throw new Error('Failed to execute Redis pipeline');
    }

    const edges: Edge[] = [];

    for (let i = 0; i < results.length; i++) {
      const [error, rawNeighbors] = results[i] ?? [];
      const from = nodes[i];
      if (error || from === undefined) continue;

      const neighbors = rawNeighbors as Record<Node, string>;

      for (const [to, rawValue] of Object.entries(neighbors)) {
        const value = Number.parseFloat(rawValue);
        if (!Number.isNaN(value)) {
          edges.push({ from, to, value });
        }
      }
    }

    return edges;
  }

  async getEventGraph() {
    const [edges, nodes] = await Promise.all([this.listEdges(), this.listNodesMetadata()]);

    return { nodes, edges };
  }
}
