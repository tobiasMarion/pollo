import {
  type Edge,
  type Metadata,
  metadataSchema,
  type Node,
  type NodePosition,
  type NodesWithMetadata,
} from '@pollo/contracts'
import type { Redis } from 'ioredis'
import type { GraphBatch } from '../batching/graph-writer.js'

const TTL_SECONDS = 43_200 // 12 hours

/**
 * Persists the distance graph of an event in Redis: a set of nodes, a hash of
 * edges per node, a reverse set of who measured each node, and one hash each for
 * locations and worker positions. Serves REST reads and worker hydration; every
 * key carries a TTL so abandoned events evaporate on their own.
 *
 * Writes arrive as batches rather than one call per change — see `GraphWriter`.
 */
export class GraphStore {
  constructor(
    private readonly redis: Redis,
    private readonly graphId: string,
  ) {}

  private keyForEdgesFrom(node: Node) {
    return `graph:${this.graphId}:edges:${node}`
  }

  /** Who has measured this node — the reverse of `edges:<node>`. */
  private keyForEdgesTo(node: Node) {
    return `graph:${this.graphId}:edges_in:${node}`
  }

  private keyForNodesSet() {
    return `graph:${this.graphId}:nodes`
  }

  private keyForLocations() {
    return `graph:${this.graphId}:locations`
  }

  private keyForPositions() {
    return `graph:${this.graphId}:positions`
  }

  /**
   * Applies a flush in one pipeline, plus one read pass when somebody left.
   *
   * A departure has to delete the edges that name the node, and only the reverse
   * index knows who those are — that is a read, and a read cannot sit inside the
   * pipeline that depends on it. It is safe to do first: the writer drops every
   * queued edge touching a departing device, so nothing this batch is about to
   * write could be missed by the sets read here.
   */
  async applyBatch(batch: GraphBatch) {
    const orphaned = await this.readEdgesOf(batch.removed)
    const pipeline = this.redis.pipeline()
    const touched = new Set<string>()

    const touch = (key: string) => {
      touched.add(key)
      return key
    }

    for (const node of batch.removed) {
      const { measuredBy, measured } = orphaned[node] ?? { measuredBy: [], measured: [] }

      for (const from of measuredBy) pipeline.hdel(this.keyForEdgesFrom(from), node)
      for (const to of measured) pipeline.srem(this.keyForEdgesTo(to), node)

      pipeline.del(this.keyForEdgesFrom(node), this.keyForEdgesTo(node))
      pipeline.srem(touch(this.keyForNodesSet()), node)
      pipeline.hdel(touch(this.keyForLocations()), node)
      pipeline.hdel(touch(this.keyForPositions()), node)
    }

    for (const node of batch.added) {
      pipeline.sadd(touch(this.keyForNodesSet()), node)
    }

    for (const [node, location] of batch.locations) {
      pipeline.hset(touch(this.keyForLocations()), node, JSON.stringify(location))
    }

    for (const { from, to, distance } of batch.edges) {
      if (distance === null) {
        pipeline.hdel(this.keyForEdgesFrom(from), to)
        pipeline.srem(this.keyForEdgesTo(to), from)
        continue
      }

      pipeline.hset(touch(this.keyForEdgesFrom(from)), to, distance)
      pipeline.sadd(touch(this.keyForEdgesTo(to)), from)
    }

    // Once per key per flush rather than once per operation, which is where most
    // of the old command count went.
    for (const key of touched) pipeline.expire(key, TTL_SECONDS)

    await pipeline.exec()
  }

  private async readEdgesOf(nodes: readonly Node[]) {
    const found: Record<Node, { measuredBy: Node[]; measured: Node[] }> = {}

    if (nodes.length === 0) return found

    const pipeline = this.redis.pipeline()

    for (const node of nodes) {
      pipeline.smembers(this.keyForEdgesTo(node))
      pipeline.hkeys(this.keyForEdgesFrom(node))
    }

    const results = (await pipeline.exec()) ?? []

    nodes.forEach((node, index) => {
      found[node] = {
        measuredBy: (results[index * 2]?.[1] as Node[]) ?? [],
        measured: (results[index * 2 + 1]?.[1] as Node[]) ?? [],
      }
    })

    return found
  }

  /**
   * The worker's answer for one node. Written on its own path rather than
   * through a batch: positions arrive from the worker, not from the crowd.
   */
  async setNodePosition(node: Node, position: NodePosition) {
    const key = this.keyForPositions()

    await this.redis.hset(key, node, JSON.stringify(position))
    await this.redis.expire(key, TTL_SECONDS)
  }

  async getNodeMetadata(node: Node): Promise<Metadata | null> {
    const [location, position] = await Promise.all([
      this.redis.hget(this.keyForLocations(), node),
      this.redis.hget(this.keyForPositions(), node),
    ])

    if (!location) return null

    return parseMetadata(location, position)
  }

  /**
   * Two `HGETALL`s rather than a pipeline of one `HGET` per node. Locations and
   * positions are kept in separate hashes precisely so that writing one never
   * has to read the other back.
   */
  async listNodesMetadata(): Promise<NodesWithMetadata> {
    const [locations, positions] = await Promise.all([
      this.redis.hgetall(this.keyForLocations()),
      this.redis.hgetall(this.keyForPositions()),
    ])

    const metadata: NodesWithMetadata = {}

    for (const [node, location] of Object.entries(locations)) {
      const parsed = parseMetadata(location, positions[node])

      if (parsed) metadata[node] = parsed
    }

    return metadata
  }

  async listNodes() {
    return await this.redis.smembers(this.keyForNodesSet())
  }

  async listEdges(): Promise<Edge[]> {
    const nodes = await this.listNodes()
    const pipeline = this.redis.pipeline()

    for (const from of nodes) {
      pipeline.hgetall(this.keyForEdgesFrom(from))
    }

    const results = (await pipeline.exec()) ?? []
    const edges: Edge[] = []

    for (let i = 0; i < results.length; i++) {
      const [error, rawNeighbors] = results[i] ?? []
      const from = nodes[i]
      if (error || from === undefined) continue

      for (const [to, rawValue] of Object.entries(rawNeighbors as Record<Node, string>)) {
        const value = Number.parseFloat(rawValue)

        if (!Number.isNaN(value)) edges.push({ from, to, value })
      }
    }

    return edges
  }

  async getEventGraph() {
    const [edges, nodes] = await Promise.all([this.listEdges(), this.listNodesMetadata()])

    return { nodes, edges }
  }

  async deleteGraph() {
    const nodes = await this.listNodes()
    const keys = nodes.flatMap(node => [this.keyForEdgesFrom(node), this.keyForEdgesTo(node)])

    keys.push(this.keyForNodesSet(), this.keyForLocations(), this.keyForPositions())

    await this.redis.del(...keys)
  }
}

function parseMetadata(location: string, position: string | undefined | null): Metadata | null {
  const parsed = metadataSchema.safeParse({
    location: JSON.parse(location),
    position: position ? JSON.parse(position) : undefined,
  })

  return parsed.success ? parsed.data : null
}
