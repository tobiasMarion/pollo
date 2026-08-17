import type { Location } from '@pollo/contracts'
import { EventGraph } from '../ingest/graph.js'

/**
 * Scenarios the solver is asked to survive.
 *
 * Written here, from scratch, and on purpose. `apps/simulator` emulates a crowd
 * and this worker is scored against it, but that is a bench, not a source of
 * test data: a solver whose tests draw from one generator has been tuned to one
 * generator, and would be tuned to the parts of it that are wrong as eagerly as
 * to the parts that are right. What is exercised here is the *range* — including
 * regimes no friendly generator produces.
 *
 * Nothing here is imported by `src/` outside tests.
 */

/** xorshift32. Small, fast, and repeats exactly from a seed. */
export class Random {
  private state: number

  constructor(seed: number) {
    // A zero state is a fixed point of xorshift, and would give a constant.
    this.state = seed === 0 ? 0x9e37_79b9 : seed >>> 0
  }

  next() {
    let x = this.state

    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5

    this.state = x >>> 0

    return this.state / 0x1_0000_0000
  }

  between(low: number, high: number) {
    return low + this.next() * (high - low)
  }

  /** Box–Muller. One of the pair is discarded, which costs nothing that matters here. */
  gaussian() {
    const u = Math.max(this.next(), Number.EPSILON)
    const v = this.next()

    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  /** Student-t-ish: a normal divided by a small chi, so the tail is fat. */
  heavyTailed() {
    const scale = Math.sqrt(Math.max(this.next(), 0.02))

    return this.gaussian() / scale
  }
}

export type Layout = 'grid' | 'cluster' | 'chain' | 'islands' | 'tower'

export interface ScenarioOptions {
  seed?: number
  count?: number
  layout?: Layout
  /** Metres of independent error on each anchor, across the ground. */
  anchorSigma?: number
  /** And in height, which is always the worse of the two. */
  anchorVerticalSigma?: number
  /** A single offset added to every anchor — the error a crowd makes together. */
  commonBias?: readonly [number, number, number]
  /** Ranging error, as `floor + relative·d`. What the worker has to discover. */
  rangeFloor?: number
  rangeRelative?: number
  /** How the ranging error is drawn. */
  noise?: 'gaussian' | 'heavy' | 'biased'
  /** Share of measurements replaced by something meaningless. */
  outlierRate?: number
  /** Peers each device measures, and how far it can reach. */
  degree?: number
  radius?: number
}

export interface Scenario {
  truth: Float64Array
  locations: Location[]
  /** `[from, to, measured]`, directed. */
  edges: Array<[number, number, number]>
  count: number
}

const ORIGIN = { latitude: -29.6842, longitude: -53.8069 }

export function buildScenario(options: ScenarioOptions = {}): Scenario {
  const count = options.count ?? 120
  const random = new Random(options.seed ?? 1)

  const truth = layoutOf(options.layout ?? 'grid', count, random)
  const locations = anchorsOf(truth, count, random, options)
  const edges = edgesOf(truth, count, random, options)

  return { truth, locations, edges, count }
}

function layoutOf(layout: Layout, count: number, random: Random) {
  const points = new Float64Array(count * 3)

  for (let i = 0; i < count; i++) {
    const at = i * 3

    if (layout === 'grid') {
      const side = Math.ceil(Math.sqrt(count))

      // Nobody stands on the lattice. A perfectly regular one is a constraint no
      // crowd hands anybody, and a solver that needs it has been given a gift.
      points[at] = (i % side) * 1.6 + random.between(-0.3, 0.3)
      points[at + 1] = Math.floor(i / side) * 1.6 + random.between(-0.3, 0.3)
      points[at + 2] = random.between(-0.05, 0.05)
      continue
    }

    if (layout === 'cluster') {
      // Dense knots with thin space between them: degree varies wildly, which is
      // where a solver that assumes uniform support comes apart.
      const knot = i % 4
      points[at] = (knot % 2) * 14 + random.gaussian() * 1.8
      points[at + 1] = Math.floor(knot / 2) * 14 + random.gaussian() * 1.8
      points[at + 2] = random.between(-0.05, 0.05)
      continue
    }

    if (layout === 'chain') {
      // A single file. Degree two, almost no rigidity — the case where the
      // anchors are the only thing holding the shape together.
      points[at] = i * 1.4 + random.between(-0.1, 0.1)
      points[at + 1] = random.between(-0.1, 0.1)
      points[at + 2] = 0
      continue
    }

    if (layout === 'islands') {
      // Two groups far enough apart that no measurement crosses. Nothing ties
      // them to each other, and the answer has to be right anyway.
      const island = i < count / 2 ? 0 : 1
      const side = Math.ceil(Math.sqrt(count / 2))
      const local = i % Math.ceil(count / 2)

      points[at] = island * 200 + (local % side) * 1.6
      points[at + 1] = Math.floor(local / side) * 1.6
      points[at + 2] = 0
      continue
    }

    // People above other people: the layout that decides whether the vertical
    // axis is solved or merely carried along from GPS.
    const tier = i % 3
    const side = Math.ceil(Math.sqrt(count / 3))
    const local = Math.floor(i / 3)

    points[at] = (local % side) * 1.6 + random.between(-0.2, 0.2)
    points[at + 1] = Math.floor(local / side) * 1.6 + random.between(-0.2, 0.2)
    points[at + 2] = tier * 3.5
  }

  return points
}

function anchorsOf(
  truth: Float64Array,
  count: number,
  random: Random,
  options: ScenarioOptions,
): Location[] {
  const sigma = options.anchorSigma ?? 4
  const verticalSigma = options.anchorVerticalSigma ?? 9
  const bias = options.commonBias ?? [0, 0, 0]

  const locations: Location[] = []

  for (let i = 0; i < count; i++) {
    const at = i * 3

    const x = (truth[at] ?? 0) + random.gaussian() * sigma + (bias[0] ?? 0)
    const y = (truth[at + 1] ?? 0) + random.gaussian() * sigma + (bias[1] ?? 0)
    const z = (truth[at + 2] ?? 0) + random.gaussian() * verticalSigma + (bias[2] ?? 0)

    locations.push(locationAt(x, y, z, sigma, verticalSigma))
  }

  return locations
}

/**
 * Builds a `Location` that projects back to exactly `(x, y, z)` in the field
 * frame, so a scenario can be stated in metres and still arrive through the same
 * `JOIN` a real device would send.
 */
export function locationAt(x: number, y: number, z: number, sigma: number, verticalSigma: number) {
  const metresPerDegreeLatitude = 110_574
  const metresPerDegreeLongitude = 111_320 * Math.cos((ORIGIN.latitude * Math.PI) / 180)

  return {
    latitude: ORIGIN.latitude + y / metresPerDegreeLatitude,
    longitude: ORIGIN.longitude + x / metresPerDegreeLongitude,
    altitude: z,
    horizontalAccuracy: sigma,
    verticalAccuracy: verticalSigma,
  } satisfies Location
}

function edgesOf(
  truth: Float64Array,
  count: number,
  random: Random,
  options: ScenarioOptions,
): Array<[number, number, number]> {
  const degree = options.degree ?? 8
  const radius = options.radius ?? 10
  const floor = options.rangeFloor ?? 0.2
  const relative = options.rangeRelative ?? 0.08
  const noise = options.noise ?? 'gaussian'
  const outlierRate = options.outlierRate ?? 0

  const edges: Array<[number, number, number]> = []

  for (let i = 0; i < count; i++) {
    const near: Array<{ index: number; distance: number }> = []

    for (let j = 0; j < count; j++) {
      if (i === j) continue

      const distance = trueDistance(truth, i, j)

      if (distance <= radius) near.push({ index: j, distance })
    }

    near.sort((a, b) => a.distance - b.distance)

    for (const peer of near.slice(0, degree)) {
      const sigma = floor + relative * peer.distance

      const error =
        noise === 'gaussian'
          ? random.gaussian() * sigma
          : noise === 'heavy'
            ? random.heavyTailed() * sigma
            : random.gaussian() * sigma + sigma * 2

      const measured =
        random.next() < outlierRate
          ? random.between(0.1, radius * 2)
          : Math.max(0.01, peer.distance + error)

      edges.push([i, peer.index, measured])
    }
  }

  return edges
}

export function trueDistance(points: Float64Array, i: number, j: number) {
  const dx = (points[i * 3] ?? 0) - (points[j * 3] ?? 0)
  const dy = (points[i * 3 + 1] ?? 0) - (points[j * 3 + 1] ?? 0)
  const dz = (points[i * 3 + 2] ?? 0) - (points[j * 3 + 2] ?? 0)

  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Feeds a scenario through the real ingest path, so tests exercise what runs. */
export function graphOf(scenario: Scenario) {
  const graph = new EventGraph(ORIGIN)

  for (let i = 0; i < scenario.count; i++) {
    const location = scenario.locations[i]
    if (location) graph.apply({ op: 'JOIN', deviceId: `d${i}`, location })
  }

  for (const [from, to, distance] of scenario.edges) {
    graph.apply({ op: 'DISTANCE', from: `d${from}`, to: `d${to}`, distance })
  }

  return graph
}

/**
 * Root mean square distance from the truth, with **no alignment**.
 *
 * The simulator scores after a Procrustes fit because a reconstruction from
 * distances alone has no idea which way north is. Here it does: the anchors are
 * generated in the same frame as the truth, so the frame is pinned, and fitting
 * a rotation away would hide a solver that got the orientation wrong.
 */
export function rmseAgainst(estimate: Float64Array, truth: Float64Array, count: number) {
  let total = 0

  for (let i = 0; i < count; i++) {
    const dx = (estimate[i * 3] ?? 0) - (truth[i * 3] ?? 0)
    const dy = (estimate[i * 3 + 1] ?? 0) - (truth[i * 3 + 1] ?? 0)
    const dz = (estimate[i * 3 + 2] ?? 0) - (truth[i * 3 + 2] ?? 0)

    total += dx * dx + dy * dy + dz * dz
  }

  return Math.sqrt(total / count)
}

/** The control every reconstruction has to beat: the anchors, untouched. */
export function anchorCloud(graph: EventGraph, scenario: Scenario) {
  const cloud = new Float64Array(scenario.count * 3)

  for (let i = 0; i < scenario.count; i++) {
    const slot = graph.slotOf(`d${i}`) ?? 0
    const anchor = graph.anchorAt(slot)

    cloud[i * 3] = anchor.x
    cloud[i * 3 + 1] = anchor.y
    cloud[i * 3 + 2] = anchor.z
  }

  return cloud
}

/** The solver's answer, in scenario order rather than slot order. */
export function estimateCloud(
  graph: EventGraph,
  scenario: Scenario,
  at: (slot: number) => { x: number; y: number; z: number },
) {
  const cloud = new Float64Array(scenario.count * 3)

  for (let i = 0; i < scenario.count; i++) {
    const slot = graph.slotOf(`d${i}`) ?? 0
    const point = at(slot)

    cloud[i * 3] = point.x
    cloud[i * 3 + 1] = point.y
    cloud[i * 3 + 2] = point.z
  }

  return cloud
}
