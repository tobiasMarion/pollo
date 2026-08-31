import { Random } from '../../random/index.js'
import { Csr, type EdgeSource } from '../csr/index.js'
import type { Scale } from '../sigma/index.js'
import type { MdsState } from '../stress/index.js'

/**
 * Graphs to solve, built here rather than drawn from anything that emulates a
 * crowd. A solver whose tests come from one generator has been tuned to that
 * generator, and would be tuned to the parts of it that are wrong as eagerly as
 * to the parts that are right.
 *
 * Not part of the build: see `tsconfig.build.json`.
 */

export type Edge = readonly [from: number, to: number, distance: number]

/** The three members `Csr` asks for, over a plain list of edges. */
export function edgeSource(capacity: number, edges: readonly Edge[]): EdgeSource {
  return {
    capacity,
    edgeCount: edges.length,
    forEachEdge(visit) {
      for (const [from, to, distance] of edges) visit(from, to, distance)
    },
  }
}

export function csrOf(capacity: number, edges: readonly Edge[]) {
  const csr = new Csr()

  csr.rebuildIfStale(edgeSource(capacity, edges), 1)

  return csr
}

export interface CloudOptions {
  seed?: number
  count?: number
  /** Metres of independent error on each anchor, across the ground and in height. */
  anchorSigma?: number
  anchorVerticalSigma?: number
  /** Ranging error, as `floor + relative·d`. */
  rangeFloor?: number
  rangeRelative?: number
  /** Peers each point measures, and how far it can reach. */
  degree?: number
  radius?: number
}

export interface Cloud {
  count: number
  /** Where the points really are, three per slot. */
  truth: Float64Array
  /** Where each point is independently believed to be, three per slot. */
  anchors: Float64Array
  /** Horizontal and vertical anchor weight, two per slot. */
  anchorWeights: Float64Array
  slots: number[]
  edges: Edge[]
}

/** A jittered lattice: nobody stands on the grid a layout drew. */
export function cloud(options: CloudOptions = {}): Cloud {
  const count = options.count ?? 60
  const random = new Random(options.seed ?? 1)

  const anchorSigma = options.anchorSigma ?? 4
  const anchorVerticalSigma = options.anchorVerticalSigma ?? 9
  const floor = options.rangeFloor ?? 0.2
  const relative = options.rangeRelative ?? 0.08
  const degree = options.degree ?? 8
  const radius = options.radius ?? 10

  const truth = new Float64Array(count * 3)
  const anchors = new Float64Array(count * 3)
  const anchorWeights = new Float64Array(count * 2)
  const side = Math.ceil(Math.sqrt(count))

  for (let i = 0; i < count; i++) {
    truth[i * 3] = (i % side) * 1.6 + random.between(-0.3, 0.3)
    truth[i * 3 + 1] = Math.floor(i / side) * 1.6 + random.between(-0.3, 0.3)
    truth[i * 3 + 2] = random.between(-0.05, 0.05)
  }

  for (let i = 0; i < count; i++) {
    anchors[i * 3] = (truth[i * 3] ?? 0) + random.gaussian() * anchorSigma
    anchors[i * 3 + 1] = (truth[i * 3 + 1] ?? 0) + random.gaussian() * anchorSigma
    anchors[i * 3 + 2] = (truth[i * 3 + 2] ?? 0) + random.gaussian() * anchorVerticalSigma

    anchorWeights[i * 2] = 1 / (anchorSigma * anchorSigma)
    anchorWeights[i * 2 + 1] = 1 / (anchorVerticalSigma * anchorVerticalSigma)
  }

  const edges: Edge[] = []

  for (let i = 0; i < count; i++) {
    const near: Array<{ index: number; distance: number }> = []

    for (let j = 0; j < count; j++) {
      if (i === j) continue

      const gap = trueDistance(truth, i, j)

      if (gap <= radius) near.push({ index: j, distance: gap })
    }

    near.sort((a, b) => a.distance - b.distance)

    for (const peer of near.slice(0, degree)) {
      const sigma = floor + relative * peer.distance
      const measured = Math.max(0.01, peer.distance + random.gaussian() * sigma)

      edges.push([i, peer.index, measured])
    }
  }

  return {
    count,
    truth,
    anchors,
    anchorWeights,
    slots: Array.from({ length: count }, (_, slot) => slot),
    edges,
  }
}

export function trueDistance(points: Float64Array, i: number, j: number) {
  const dx = (points[i * 3] ?? 0) - (points[j * 3] ?? 0)
  const dy = (points[i * 3 + 1] ?? 0) - (points[j * 3 + 1] ?? 0)
  const dz = (points[i * 3 + 2] ?? 0) - (points[j * 3 + 2] ?? 0)

  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Started from the anchors, which is where the worker starts a newcomer. */
export function stateOf(built: Cloud, scale: Scale): MdsState {
  return {
    positions: new Float64Array(built.anchors),
    anchors: built.anchors,
    anchorWeights: built.anchorWeights,
    slots: built.slots,
    graph: csrOf(built.count, built.edges),
    scale,
  }
}

/** No alignment: the anchors are in the truth's own frame, so the frame is pinned. */
export function rmse(estimate: Float64Array, truth: Float64Array, count: number) {
  let total = 0

  for (let i = 0; i < count * 3; i++) {
    const delta = (estimate[i] ?? 0) - (truth[i] ?? 0)
    total += delta * delta
  }

  return Math.sqrt(total / count)
}
