/**
 * Three-by-three, row-major, in flat `Float64Array`s.
 *
 * Small enough that a matrix type would cost more than it explains, and used in
 * exactly one place where the numbers matter: fitting a rigid motion between two
 * clouds. Everything here is total — no allocation beyond the result, no state.
 */

const PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 2],
  [1, 2],
]

export function multiply(left: Float64Array, right: Float64Array) {
  const out = new Float64Array(9)

  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      let sum = 0
      for (let k = 0; k < 3; k++) sum += (left[row * 3 + k] ?? 0) * (right[k * 3 + column] ?? 0)
      out[row * 3 + column] = sum
    }
  }

  return out
}

export function transpose(matrix: Float64Array) {
  const out = new Float64Array(9)

  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      out[column * 3 + row] = matrix[row * 3 + column] ?? 0
    }
  }

  return out
}

export function determinant(m: Float64Array) {
  const [a, b, c, d, e, f, g, h, i] = [
    m[0] ?? 0,
    m[1] ?? 0,
    m[2] ?? 0,
    m[3] ?? 0,
    m[4] ?? 0,
    m[5] ?? 0,
    m[6] ?? 0,
    m[7] ?? 0,
    m[8] ?? 0,
  ]

  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
}

export interface Eigen {
  /** The diagonal after convergence, in column order of `vectors`. */
  values: number[]
  /** Eigenvectors as columns, row-major. */
  vectors: Float64Array
}

/**
 * Cyclic Jacobi on a symmetric 3×3. A closed form loses precision exactly where
 * a cloud is nearly planar, and a crowd standing on a floor is exactly that:
 * every venue here is far wider than it is tall.
 */
export function symmetricEigen(input: Float64Array): Eigen {
  const a = Float64Array.from(input)
  const vectors = Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1])

  for (let sweep = 0; sweep < 10; sweep++) {
    let offDiagonal = 0
    for (const [p, q] of PAIRS) offDiagonal += (a[p * 3 + q] ?? 0) ** 2
    if (offDiagonal < 1e-24) break

    for (const [p, q] of PAIRS) {
      const apq = a[p * 3 + q] ?? 0
      if (Math.abs(apq) < 1e-30) continue

      const app = a[p * 3 + p] ?? 0
      const aqq = a[q * 3 + q] ?? 0

      const theta = (aqq - app) / (2 * apq)
      const sign = theta >= 0 ? 1 : -1
      const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const cos = 1 / Math.sqrt(t * t + 1)
      const sin = t * cos

      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p] ?? 0
        const akq = a[k * 3 + q] ?? 0
        a[k * 3 + p] = cos * akp - sin * akq
        a[k * 3 + q] = sin * akp + cos * akq
      }

      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k] ?? 0
        const aqk = a[q * 3 + k] ?? 0
        a[p * 3 + k] = cos * apk - sin * aqk
        a[q * 3 + k] = sin * apk + cos * aqk
      }

      for (let k = 0; k < 3; k++) {
        const vkp = vectors[k * 3 + p] ?? 0
        const vkq = vectors[k * 3 + q] ?? 0
        vectors[k * 3 + p] = cos * vkp - sin * vkq
        vectors[k * 3 + q] = sin * vkp + cos * vkq
      }
    }
  }

  return { values: [a[0] ?? 0, a[4] ?? 0, a[8] ?? 0], vectors }
}
