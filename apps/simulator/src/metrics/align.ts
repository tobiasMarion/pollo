import { type Vector3, vector } from '@pollo/contracts'

/** A rigid motion: a rotation in row-major order, then a translation. */
export interface Alignment {
  rotation: Float64Array
  translation: Vector3
}

export const IDENTITY_ALIGNMENT: Alignment = {
  rotation: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  translation: { x: 0, y: 0, z: 0 },
}

/**
 * Cyclic Jacobi on a symmetric 3×3. A closed form loses precision exactly where
 * a cloud is nearly planar, and a crowd standing on a floor is exactly that:
 * every venue here is far wider than it is tall.
 */
function symmetricEigen(input: Float64Array) {
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

const PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 2],
  [1, 2],
]

function multiply(left: Float64Array, right: Float64Array) {
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

function transpose(matrix: Float64Array) {
  const out = new Float64Array(9)

  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      out[column * 3 + row] = matrix[row * 3 + column] ?? 0
    }
  }

  return out
}

function determinant(m: Float64Array) {
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

function centroid(points: Float32Array, count: number) {
  let x = 0
  let y = 0
  let z = 0

  for (let i = 0; i < count; i++) {
    x += points[i * 3] ?? 0
    y += points[i * 3 + 1] ?? 0
    z += points[i * 3 + 2] ?? 0
  }

  return { x: x / count, y: y / count, z: z / count }
}

/**
 * Kabsch. A reconstruction from distances alone is invariant to rotation,
 * translation and reflection, so an unaligned comparison scores the arbitrary
 * part of the answer.
 *
 * Scale is deliberately not fitted. Distances carry it, so a reconstruction that
 * came out half size got something wrong, and fitting the scale away would hide
 * exactly that.
 */
export function alignClouds(from: Float32Array, to: Float32Array, count: number): Alignment {
  if (count < 3) return IDENTITY_ALIGNMENT

  const centreFrom = centroid(from, count)
  const centreTo = centroid(to, count)

  // Locals rather than an array: nine running sums over twenty thousand points
  // is the one place in this file where a bounds check per term would show.
  let xx = 0
  let xy = 0
  let xz = 0
  let yx = 0
  let yy = 0
  let yz = 0
  let zx = 0
  let zy = 0
  let zz = 0

  for (let i = 0; i < count; i++) {
    const fx = (from[i * 3] ?? 0) - centreFrom.x
    const fy = (from[i * 3 + 1] ?? 0) - centreFrom.y
    const fz = (from[i * 3 + 2] ?? 0) - centreFrom.z

    const tx = (to[i * 3] ?? 0) - centreTo.x
    const ty = (to[i * 3 + 1] ?? 0) - centreTo.y
    const tz = (to[i * 3 + 2] ?? 0) - centreTo.z

    xx += fx * tx
    xy += fx * ty
    xz += fx * tz
    yx += fy * tx
    yy += fy * ty
    yz += fy * tz
    zx += fz * tx
    zy += fz * ty
    zz += fz * tz
  }

  const h = Float64Array.from([xx, xy, xz, yx, yy, yz, zx, zy, zz])

  const hTranspose = transpose(h)
  const { values, vectors } = symmetricEigen(multiply(hTranspose, h))

  const singular = values.map(value => Math.sqrt(Math.max(value, 0)))
  const largest = Math.max(...singular)

  // A cloud collapsed onto a line or a point has no unique rotation. Refusing
  // to invent one is better than returning a random turn as if it were a fit.
  if (largest < 1e-9) return IDENTITY_ALIGNMENT

  const u = new Float64Array(9)

  for (let column = 0; column < 3; column++) {
    const sigma = singular[column] ?? 0
    if (sigma < largest * 1e-7) continue

    for (let row = 0; row < 3; row++) {
      let sum = 0
      for (let k = 0; k < 3; k++) sum += (h[row * 3 + k] ?? 0) * (vectors[k * 3 + column] ?? 0)
      u[row * 3 + column] = sum / sigma
    }
  }

  // `vectors` holds V, so V·Uᵀ is the candidate rotation. A negative
  // determinant means the best fit is a mirror image, which no rigid body can
  // be — the last axis is flipped back, and the cloud is left to look as wrong
  // as it is.
  const candidate = multiply(vectors, transpose(u))
  const reflected = determinant(candidate) < 0

  const corrected = Float64Array.from(vectors)

  if (reflected) {
    for (let row = 0; row < 3; row++) corrected[row * 3 + 2] = -(corrected[row * 3 + 2] ?? 0)
  }

  const rotation = multiply(corrected, transpose(u))
  const turnedCentre = rotate(rotation, centreFrom)

  return { rotation, translation: vector.subtract(centreTo, turnedCentre) }
}

function rotate(rotation: Float64Array, point: Vector3): Vector3 {
  return {
    x: (rotation[0] ?? 0) * point.x + (rotation[1] ?? 0) * point.y + (rotation[2] ?? 0) * point.z,
    y: (rotation[3] ?? 0) * point.x + (rotation[4] ?? 0) * point.y + (rotation[5] ?? 0) * point.z,
    z: (rotation[6] ?? 0) * point.x + (rotation[7] ?? 0) * point.y + (rotation[8] ?? 0) * point.z,
  }
}

export function applyAlignment({ rotation, translation }: Alignment, point: Vector3): Vector3 {
  return vector.add(rotate(rotation, point), translation)
}
