import type { Vector3 } from './graph.js'

/**
 * Arithmetic on the `Vector3` the whole system speaks in.
 *
 * It lives here rather than in one app because every side of Pollo does the same
 * sums: the simulator adds an error to a position, the panel interpolates
 * between two of them, and an effect measures a pixel against the middle of a
 * pass. Written out component by component, each of those is three lines that
 * differ only in an axis, which is three chances to type `y` where `x` belongs
 * — a bug that reads as a slightly wrong field rather than as a mistake.
 *
 * Every function returns a new vector and mutates nothing. That has a cost, and
 * it is deliberate: where the cost matters — the panel projecting twenty
 * thousand pixels a frame, the simulator sweeping neighbours out of a
 * `Float32Array` — the loops work on packed numbers and do not go through here
 * at all.
 */

export const ZERO: Vector3 = { x: 0, y: 0, z: 0 }

export function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function subtract(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function scale(vector: Vector3, factor: number): Vector3 {
  return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor }
}

/** `a` plus `b` scaled — the step every integrator takes, without a temporary. */
export function addScaled(a: Vector3, b: Vector3, factor: number): Vector3 {
  return { x: a.x + b.x * factor, y: a.y + b.y * factor, z: a.z + b.z * factor }
}

/**
 * Straight line from `a` to `b`, at `progress` along it. Not clamped: callers
 * that need it bounded clamp `progress`, and callers extrapolating deliberately
 * should not have to fight this.
 */
export function lerp(a: Vector3, b: Vector3, progress: number): Vector3 {
  return {
    x: a.x + (b.x - a.x) * progress,
    y: a.y + (b.y - a.y) * progress,
    z: a.z + (b.z - a.z) * progress,
  }
}

export function length(vector: Vector3): number {
  return Math.hypot(vector.x, vector.y, vector.z)
}

export function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

/** Length one, in the same direction. A zero vector has no direction and stays zero. */
export function normalize(vector: Vector3): Vector3 {
  const size = length(vector)

  return size === 0 ? ZERO : scale(vector, 1 / size)
}

/** The average of a cloud. Empty is the origin, which is where nothing is. */
export function centroid(points: readonly Vector3[]): Vector3 {
  if (points.length === 0) return ZERO

  let x = 0
  let y = 0
  let z = 0

  for (const point of points) {
    x += point.x
    y += point.y
    z += point.z
  }

  return { x: x / points.length, y: y / points.length, z: z / points.length }
}
