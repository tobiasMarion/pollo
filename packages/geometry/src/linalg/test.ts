import { describe, expect, it } from 'vitest'
import { determinant, multiply, symmetricEigen, transpose } from './index.js'

const identity = Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1])

describe('multiply', () => {
  it('leaves a matrix alone when multiplied by the identity', () => {
    const m = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9])

    expect([...multiply(m, identity)]).toEqual([...m])
    expect([...multiply(identity, m)]).toEqual([...m])
  })

  it('multiplies row by column', () => {
    const a = Float64Array.from([1, 2, 0, 0, 1, 0, 0, 0, 1])
    const b = Float64Array.from([1, 0, 0, 3, 1, 0, 0, 0, 1])

    expect([...multiply(a, b)]).toEqual([7, 2, 0, 3, 1, 0, 0, 0, 1])
  })
})

describe('transpose', () => {
  it('swaps rows and columns, and is its own inverse', () => {
    const m = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9])

    expect([...transpose(m)]).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9])
    expect([...transpose(transpose(m))]).toEqual([...m])
  })
})

describe('determinant', () => {
  it('is one for the identity and zero for a singular matrix', () => {
    expect(determinant(identity)).toBe(1)
    expect(determinant(Float64Array.from([1, 2, 3, 2, 4, 6, 7, 8, 9]))).toBeCloseTo(0, 12)
  })

  /** The sign is the whole point: it is what tells a reflection from a rotation. */
  it('goes negative for a reflection', () => {
    expect(determinant(Float64Array.from([-1, 0, 0, 0, 1, 0, 0, 0, 1]))).toBe(-1)
  })
})

describe('symmetricEigen', () => {
  it('reads a diagonal matrix straight off, without turning anything', () => {
    const { values, vectors } = symmetricEigen(Float64Array.from([3, 0, 0, 0, 2, 0, 0, 0, 1]))

    expect(values).toEqual([3, 2, 1])
    expect([...vectors]).toEqual([...identity])
  })

  /**
   * The claim, on a matrix that actually needs rotating: `A·v = λ·v` for each
   * eigenvector, and the eigenvectors are orthonormal. Everything the alignment
   * does with the result rests on both.
   */
  it('finds eigenpairs that satisfy their own definition', () => {
    const a = Float64Array.from([4, 1, 2, 1, 3, 0, 2, 0, 5])
    const { values, vectors } = symmetricEigen(a)

    for (let column = 0; column < 3; column++) {
      const v = [vectors[column] ?? 0, vectors[3 + column] ?? 0, vectors[6 + column] ?? 0]

      let norm = 0
      for (const component of v) norm += component * component
      expect(norm).toBeCloseTo(1, 10)

      for (let row = 0; row < 3; row++) {
        let sum = 0
        for (let k = 0; k < 3; k++) sum += (a[row * 3 + k] ?? 0) * (v[k] ?? 0)
        expect(sum).toBeCloseTo((values[column] ?? 0) * (v[row] ?? 0), 8)
      }
    }
  })

  it('leaves an already-converged off-diagonal alone', () => {
    // Off-diagonal below the sweep's tolerance: the loop must break out rather
    // than rotate on noise.
    const { values } = symmetricEigen(Float64Array.from([2, 1e-20, 0, 1e-20, 2, 0, 0, 0, 2]))

    expect(values.map(value => Math.round(value))).toEqual([2, 2, 2])
  })
})
