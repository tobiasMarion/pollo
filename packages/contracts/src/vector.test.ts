import { describe, expect, it } from 'vitest'
import {
  add,
  addScaled,
  centroid,
  distance,
  length,
  lerp,
  normalize,
  scale,
  subtract,
  ZERO,
} from './vector.js'

const a = { x: 1, y: 2, z: 3 }
const b = { x: 10, y: 20, z: 30 }

describe('vector arithmetic', () => {
  it('adds and subtracts on every axis', () => {
    expect(add(a, b)).toEqual({ x: 11, y: 22, z: 33 })
    expect(subtract(b, a)).toEqual({ x: 9, y: 18, z: 27 })
  })

  it('is inverted by its opposite', () => {
    expect(subtract(add(a, b), b)).toEqual(a)
  })

  it('leaves its arguments alone', () => {
    add(a, b)
    scale(a, 5)

    expect(a).toEqual({ x: 1, y: 2, z: 3 })
    expect(b).toEqual({ x: 10, y: 20, z: 30 })
  })

  it('scales every axis by the same factor', () => {
    expect(scale(a, 3)).toEqual({ x: 3, y: 6, z: 9 })
    expect(scale(a, 0)).toEqual(ZERO)
  })

  it('adds a scaled vector without a temporary', () => {
    expect(addScaled(a, b, 0.5)).toEqual(add(a, scale(b, 0.5)))
  })
})

describe('lerp', () => {
  it('lands on each end', () => {
    expect(lerp(a, b, 0)).toEqual(a)
    expect(lerp(a, b, 1)).toEqual(b)
  })

  it('halves the way between', () => {
    expect(lerp(a, b, 0.5)).toEqual({ x: 5.5, y: 11, z: 16.5 })
  })

  it('extrapolates rather than clamping', () => {
    expect(lerp(a, b, 2)).toEqual({ x: 19, y: 38, z: 57 })
  })
})

describe('length and distance', () => {
  it('measures a right triangle', () => {
    expect(length({ x: 3, y: 4, z: 0 })).toBe(5)
    expect(length(ZERO)).toBe(0)
  })

  it('is the length of the difference', () => {
    expect(distance(a, b)).toBeCloseTo(length(subtract(a, b)), 12)
  })

  it('does not care which way round it is asked', () => {
    expect(distance(a, b)).toBe(distance(b, a))
  })
})

describe('normalize', () => {
  it('keeps the direction and drops the size', () => {
    const unit = normalize({ x: 0, y: 0, z: -7 })

    expect(unit).toEqual({ x: 0, y: 0, z: -1 })
    expect(length(normalize(b))).toBeCloseTo(1, 12)
  })

  it('leaves a zero vector alone rather than dividing by nothing', () => {
    expect(normalize(ZERO)).toEqual(ZERO)
  })
})

describe('centroid', () => {
  it('averages a cloud', () => {
    expect(centroid([a, b])).toEqual({ x: 5.5, y: 11, z: 16.5 })
  })

  it('of one point is that point', () => {
    expect(centroid([a])).toEqual(a)
  })

  it('of nothing is the origin', () => {
    expect(centroid([])).toEqual(ZERO)
  })
})
