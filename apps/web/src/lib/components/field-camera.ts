import { type Vector3, vector } from '@pollo/geometry'
import type { FieldPixel } from '$lib/field'

const PADDING_PX = 48
const MIN_SCALE = 0.4
const MAX_SCALE = 60
const DEFAULT_SCALE = 12
const ZOOM_PER_NOTCH = 1.0015

/**
 * The yaw avoids a mirrored corner view. The pitch clears a typical stadium
 * rake, so the near stand reads as a surface seen from above rather than below.
 */
const DEFAULT_YAW = (32 * Math.PI) / 180
const DEFAULT_PITCH = (50 * Math.PI) / 180
const MIN_PITCH = (6 * Math.PI) / 180
const MAX_PITCH = (88 * Math.PI) / 180

const REFRAME_FILL = 0.72
const REFRAME_MIN_FILL = 0.3
const STRAY_REACH = 0.35
const REFRAME_EASE = 0.06

export type CanvasPoint = { x: number; y: number }

/**
 * An orthographic view of the field.
 *
 * It owns only the lens: orientation, scale and the deliberately damped
 * framing. Drawing and input stay with the canvas that uses it.
 */
export class FieldCamera {
  width = 0
  height = 0
  scale = DEFAULT_SCALE

  #origin = vector.ZERO
  #yaw = DEFAULT_YAW
  #pitch = DEFAULT_PITCH
  #cosYaw = Math.cos(this.#yaw)
  #sinYaw = Math.sin(this.#yaw)
  #cosPitch = Math.cos(this.#pitch)
  #sinPitch = Math.sin(this.#pitch)
  #chosenScale: number | null = null
  #reframing = true

  resize(width: number, height: number) {
    this.width = width
    this.height = height
    this.#reframing = true
  }

  orbit(byYaw: number, byPitch: number) {
    this.#yaw += byYaw
    this.#pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.#pitch + byPitch))
    this.#refreshTrigonometry()
  }

  reset() {
    this.#yaw = DEFAULT_YAW
    this.#pitch = DEFAULT_PITCH
    this.#chosenScale = null
    this.#reframing = true
    this.#refreshTrigonometry()
  }

  zoom(deltaY: number) {
    const next = (this.#chosenScale ?? this.scale) * ZOOM_PER_NOTCH ** -deltaY
    this.#chosenScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
    this.scale = this.#chosenScale
  }

  project(point: Vector3): CanvasPoint {
    const { u, v } = this.toCamera(
      point.x - this.#origin.x,
      point.y - this.#origin.y,
      point.z - this.#origin.z,
    )

    return { x: this.width / 2 + u * this.scale, y: this.height / 2 + v * this.scale }
  }

  depthOf(point: Vector3) {
    return this.toCamera(
      point.x - this.#origin.x,
      point.y - this.#origin.y,
      point.z - this.#origin.z,
    ).depth
  }

  toCamera(dx: number, dy: number, dz: number) {
    const east = dx * this.#cosYaw - dy * this.#sinYaw
    const north = dx * this.#sinYaw + dy * this.#cosYaw

    return {
      u: east,
      v: -(north * this.#sinPitch + dz * this.#cosPitch),
      depth: north * this.#cosPitch - dz * this.#sinPitch,
    }
  }

  /** Screen length of a metre along the field's x axis, before scale. */
  get xForeshortening() {
    return Math.hypot(this.#cosYaw, this.#sinYaw * this.#sinPitch)
  }

  /** Move only when the crowd has escaped its frame, then settle with slack. */
  fit(pixels: FieldPixel[]) {
    if (pixels.length === 0) return

    const view = this.#framing(pixels)

    if (!this.#reframing) {
      const zoomedIn = this.#chosenScale !== null && view.fill > 1
      const escaped = zoomedIn ? view.reach - view.fill > STRAY_REACH : view.reach > 1
      const lost = this.#chosenScale === null && view.fill < REFRAME_MIN_FILL

      if (!escaped && !lost) return
      this.#reframing = true
    }

    const center = vector.centroid(pixels.map(pixel => pixel.point))
    const target =
      view.spanU < 0.01 && view.spanV < 0.01
        ? DEFAULT_SCALE
        : Math.min(
            (view.usableWidth * REFRAME_FILL) / Math.max(view.spanU, 0.01),
            (view.usableHeight * REFRAME_FILL) / Math.max(view.spanV, 0.01),
          )
    const wanted = this.#chosenScale ?? Math.min(Math.max(target, MIN_SCALE), MAX_SCALE)

    this.scale += (wanted - this.scale) * REFRAME_EASE
    this.#origin = {
      x: this.#origin.x + (center.x - this.#origin.x) * REFRAME_EASE,
      y: this.#origin.y + (center.y - this.#origin.y) * REFRAME_EASE,
      z: this.#origin.z + (center.z - this.#origin.z) * REFRAME_EASE,
    }

    const settled =
      Math.abs(wanted - this.scale) < wanted * 0.01 &&
      Math.hypot(center.x - this.#origin.x, center.y - this.#origin.y, center.z - this.#origin.z) <
        Math.max(view.spanU, view.spanV) * 0.02 + 0.01

    if (settled) this.#reframing = false
  }

  #framing(pixels: FieldPixel[]) {
    let minU = Number.POSITIVE_INFINITY
    let maxU = Number.NEGATIVE_INFINITY
    let minV = Number.POSITIVE_INFINITY
    let maxV = Number.NEGATIVE_INFINITY

    for (const { point } of pixels) {
      const { u, v } = this.toCamera(
        point.x - this.#origin.x,
        point.y - this.#origin.y,
        point.z - this.#origin.z,
      )

      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }

    const usableWidth = Math.max(this.width - PADDING_PX * 2, 1)
    const usableHeight = Math.max(this.height - PADDING_PX * 2, 1)
    const reach = Math.max(
      (Math.max(maxU, -minU) * this.scale) / (usableWidth / 2),
      (Math.max(maxV, -minV) * this.scale) / (usableHeight / 2),
    )

    return {
      spanU: maxU - minU,
      spanV: maxV - minV,
      usableWidth,
      usableHeight,
      reach,
      fill: Math.max(
        ((maxU - minU) * this.scale) / usableWidth,
        ((maxV - minV) * this.scale) / usableHeight,
      ),
    }
  }

  #refreshTrigonometry() {
    this.#cosYaw = Math.cos(this.#yaw)
    this.#sinYaw = Math.sin(this.#yaw)
    this.#cosPitch = Math.cos(this.#pitch)
    this.#sinPitch = Math.sin(this.#pitch)
  }
}
