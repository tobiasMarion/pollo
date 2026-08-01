<script lang="ts">
import {
  type Edge,
  type Effect,
  type EffectName,
  type EffectOf,
  effectBrightness,
  type Vector3,
} from '@pollo/contracts'
import { onMount } from 'svelte'
import type { FieldPixel } from '$lib/field'

/**
 * The field in meters, relative to the event origin, seen from a raised corner.
 * This is the panel: everything else on screen is a caption for it.
 *
 * The view is axonometric rather than from directly above, because a crowd in a
 * stadium is a bowl and a plan view flattens it into a ring — the rake of the
 * stands, the tiers and the height a device is reporting all disappear. It is
 * orthographic rather than perspective: a metre has to stay a metre wherever it
 * sits, or the ruler is a lie and comparing two ends of the field by eye stops
 * working.
 */
let {
  pixels,
  edges,
  lastEffect,
}: {
  pixels: FieldPixel[]
  edges: Edge[]
  lastEffect: { effect: Effect; firedAt: number } | null
} = $props()

let canvas: HTMLCanvasElement

const PADDING_PX = 48
const MIN_SCALE = 0.4
const MAX_SCALE = 60
const DEFAULT_SCALE = 12

/**
 * Camera angles. The yaw is deliberately not 45°, which would put a corner of
 * the bowl square to the viewer and make the two halves mirror each other; off
 * the diagonal, one straight side reads as the near stand and the shape is
 * legible. The pitch is near the isometric 35.26°, high enough to keep the ring
 * open and low enough that the rake is visible.
 */
const YAW = (32 * Math.PI) / 180
const PITCH = (36 * Math.PI) / 180

const COS_YAW = Math.cos(YAW)
const SIN_YAW = Math.sin(YAW)
const COS_PITCH = Math.cos(PITCH)
const SIN_PITCH = Math.sin(PITCH)

/** A point in canvas pixels, as opposed to the meters `Vector3` carries. */
type Vector2 = { x: number; y: number }

/** Camera-space coordinates of a field offset, before scale and centering. */
function toCamera(dx: number, dy: number, dz: number) {
  const east = dx * COS_YAW - dy * SIN_YAW
  const north = dx * SIN_YAW + dy * COS_YAW

  return {
    u: east,
    v: -(north * SIN_PITCH + dz * COS_PITCH),
    /** Distance along the view direction — larger is further from the camera. */
    depth: north * COS_PITCH - dz * SIN_PITCH,
  }
}

/** How much a meter along the x axis is worth on screen, for the ruler. */
const X_AXIS_FORESHORTENING = Math.hypot(COS_YAW, SIN_YAW * SIN_PITCH)

function centroid(list: FieldPixel[]): Vector3 {
  if (list.length === 0) return { x: 0, y: 0, z: 0 }

  const sum = list.reduce(
    (total, { point }) => ({
      x: total.x + point.x,
      y: total.y + point.y,
      z: total.z + point.z,
    }),
    { x: 0, y: 0, z: 0 },
  )

  return { x: sum.x / list.length, y: sum.y / list.length, z: sum.z / list.length }
}

/** A round number of meters that lands between 60 and 160 pixels. */
function rulerMeters(scale: number): number {
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
  return steps.find(step => step * scale >= 60) ?? steps[steps.length - 1]
}

onMount(() => {
  const context2d = canvas.getContext('2d')
  if (!context2d) return

  // Bound after the guard so the draw helpers below see a non-null context.
  const context = context2d

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  let width = 0
  let height = 0
  let frame = 0

  // Damped so a device joining at the edge slides the field instead of
  // snapping it out from under the operator.
  let scale = DEFAULT_SCALE
  let originX = 0
  let originY = 0
  let originZ = 0

  function resize() {
    const ratio = window.devicePixelRatio || 1
    width = canvas.clientWidth
    height = canvas.clientHeight
    canvas.width = width * ratio
    canvas.height = height * ratio
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
  }

  function fit(list: FieldPixel[]) {
    if (list.length === 0) return

    const center = centroid(list)

    // Measured on the projected shape, not on the x/y spans: at this angle a
    // tall bowl and a flat one of the same footprint need different zoom.
    let minU = Number.POSITIVE_INFINITY
    let maxU = Number.NEGATIVE_INFINITY
    let minV = Number.POSITIVE_INFINITY
    let maxV = Number.NEGATIVE_INFINITY

    for (const { point } of list) {
      const { u, v } = toCamera(point.x - center.x, point.y - center.y, point.z - center.z)

      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }

    const spanU = maxU - minU
    const spanV = maxV - minV

    const usableWidth = Math.max(width - PADDING_PX * 2, 1)
    const usableHeight = Math.max(height - PADDING_PX * 2, 1)
    const target =
      spanU < 0.01 && spanV < 0.01
        ? DEFAULT_SCALE
        : Math.min(usableWidth / Math.max(spanU, 0.01), usableHeight / Math.max(spanV, 0.01))

    scale += (Math.min(Math.max(target, MIN_SCALE), MAX_SCALE) - scale) * 0.06
    originX += (center.x - originX) * 0.06
    originY += (center.y - originY) * 0.06
    originZ += (center.z - originZ) * 0.06
  }

  function project(point: Vector3): Vector2 {
    const { u, v } = toCamera(point.x - originX, point.y - originY, point.z - originZ)

    return { x: width / 2 + u * scale, y: height / 2 + v * scale }
  }

  function depthOf(point: Vector3) {
    return toCamera(point.x - originX, point.y - originY, point.z - originZ).depth
  }

  /**
   * The three field axes through the event origin. Barely visible on purpose —
   * they are there to say which way is which, and a 3D view without them leaves
   * a cloud of dots with no way to tell a tilt from a translation.
   */
  function drawAxes(extent: Vector3) {
    const axes: Array<{ label: string; end: Vector3 }> = [
      { label: 'x', end: { x: extent.x, y: 0, z: 0 } },
      { label: 'y', end: { x: 0, y: extent.y, z: 0 } },
      { label: 'z', end: { x: 0, y: 0, z: extent.z } },
    ]

    const origin = project({ x: 0, y: 0, z: 0 })

    context.lineWidth = 1
    context.font = '10px "Space Mono", monospace'

    for (const { label, end } of axes) {
      const tip = project(end)
      // The negative half is fainter still: it marks the axis without
      // competing with the crowd for attention.
      const tail = project({ x: -end.x, y: -end.y, z: -end.z })

      context.strokeStyle = 'rgba(158, 151, 176, 0.05)'
      context.beginPath()
      context.moveTo(tail.x, tail.y)
      context.lineTo(origin.x, origin.y)
      context.stroke()

      context.strokeStyle = 'rgba(158, 151, 176, 0.13)'
      context.beginPath()
      context.moveTo(origin.x, origin.y)
      context.lineTo(tip.x, tip.y)
      context.stroke()

      context.fillStyle = 'rgba(158, 151, 176, 0.28)'
      context.fillText(label, tip.x + 4, tip.y - 4)
    }
  }

  function drawEdges(list: Edge[], positions: Map<string, Vector3>) {
    context.strokeStyle = 'rgba(245, 242, 252, 0.09)'
    context.lineWidth = 1
    context.beginPath()

    for (const edge of list) {
      const from = positions.get(edge.from)
      const to = positions.get(edge.to)
      if (!from || !to) continue

      const a = project(from)
      const b = project(to)

      context.moveTo(a.x, a.y)
      context.lineTo(b.x, b.y)
    }

    context.stroke()
  }

  /** A device the worker has not placed yet: shown, but not as light. */
  function drawUnplaced(point: Vector3) {
    const at = project(point)

    context.strokeStyle = 'rgba(158, 151, 176, 0.55)'
    context.lineWidth = 1
    context.beginPath()
    context.arc(at.x, at.y, 3.5, 0, Math.PI * 2)
    context.stroke()
  }

  function drawPixel(point: Vector3, glow: number) {
    const { x, y } = project(point)
    const core = 2 + glow * 1.6
    const halo = context.createRadialGradient(x, y, 0, x, y, core * 7)

    halo.addColorStop(0, `rgba(245, 242, 252, ${0.1 + glow * 0.4})`)
    halo.addColorStop(1, 'rgba(245, 242, 252, 0)')

    context.fillStyle = halo
    context.beginPath()
    context.arc(x, y, core * 7, 0, Math.PI * 2)
    context.fill()

    context.fillStyle = `rgba(245, 242, 252, ${0.5 + glow * 0.5})`
    context.beginPath()
    context.arc(x, y, core, 0, Math.PI * 2)
    context.fill()
  }

  const meters = (seconds: number, perUnit: number) => (perUnit > 0 ? seconds / perUnit : 0)

  /** Two points in the field, projected and stroked as one segment. */
  function fieldLine(from: Vector3, to: Vector3) {
    const a = project(from)
    const b = project(to)

    context.moveTo(a.x, a.y)
    context.lineTo(b.x, b.y)
  }

  /**
   * How each effect's leading edge is drawn, keyed by name rather than
   * switched on it: a new effect will not compile until it has a shape here.
   *
   * Every one of these works in field coordinates and projects on the way out,
   * so the wavefront sits in the same space as the crowd it is passing through.
   */
  const wavefrontByEffect: {
    [Name in EffectName]: (
      effect: EffectOf<Name>,
      elapsed: number,
      center: Vector3,
      reach: number,
    ) => void
  } = {
    PULSE: (effect, elapsed, center) => {
      // The pass is spherical — `hypot(x, y, z)` — and a sphere under an
      // orthographic camera is a circle from every angle, so this one needs no
      // projecting beyond its center.
      const radius = meters(elapsed, effect.spreadDelayPerUnit) * scale
      const at = project(center)

      context.moveTo(at.x + radius, at.y)
      context.arc(at.x, at.y, radius, 0, Math.PI * 2)
    },

    WAVE: (effect, elapsed, center, reach) => {
      const offset = meters(elapsed, effect.spreadDelayPerUnit)

      for (const sign of [-1, 1]) {
        const shift = sign * offset

        if (effect.direction === 'X') {
          fieldLine(
            { x: center.x + shift, y: center.y - reach, z: center.z },
            { x: center.x + shift, y: center.y + reach, z: center.z },
          )
        } else if (effect.direction === 'Y') {
          fieldLine(
            { x: center.x - reach, y: center.y + shift, z: center.z },
            { x: center.x + reach, y: center.y + shift, z: center.z },
          )
        } else {
          // A vertical pass had no leading edge worth drawing from above. From
          // here it does: the front is a height, so it reads as a rule floating
          // at that height.
          fieldLine(
            { x: center.x - reach, y: center.y, z: center.z + shift },
            { x: center.x + reach, y: center.y, z: center.z + shift },
          )
        }
      }
    },

    ROTATE: (effect, elapsed, center, reach) => {
      const angle = meters(elapsed, effect.spreadDelayPerRadian) - Math.PI

      fieldLine(center, {
        x: center.x + Math.cos(angle) * reach,
        y: center.y + Math.sin(angle) * reach,
        z: center.z,
      })
    },

    SPIRAL: (effect, elapsed, center) => {
      if (effect.radialSpeed <= 0) return

      let started = false

      for (let step = 0; step <= 90; step += 1) {
        const angle = (step / 90) * Math.PI * 2
        const spent = effect.angularSpeed > 0 ? angle / effect.angularSpeed : 0
        const radius = effect.radialSpeed * (elapsed - spent)

        // The arm has not reached this angle yet — the curve starts later.
        if (radius <= 0) continue

        const at = project({
          x: center.x + Math.cos(angle - Math.PI) * radius,
          y: center.y - Math.sin(angle - Math.PI) * radius,
          z: center.z,
        })

        if (started) {
          context.lineTo(at.x, at.y)
        } else {
          context.moveTo(at.x, at.y)
          started = true
        }
      }
    },
  }

  /** The cue's own geometry, so the shape of an effect is readable at a glance. */
  function drawWavefront(effect: Effect, elapsed: number, center: Vector3, reach: number) {
    context.strokeStyle = 'rgba(245, 242, 252, 0.3)'
    context.lineWidth = 1.5
    context.beginPath()

    // The record is keyed by the literal the effect is discriminated on, so
    // this pairing is sound; TypeScript cannot correlate the two on its own.
    const drawArm = wavefrontByEffect[effect.name] as (
      effect: Effect,
      elapsed: number,
      center: Vector3,
      reach: number,
    ) => void

    drawArm(effect, elapsed, center, reach)

    context.stroke()
  }

  /**
   * Drawn along the projected x axis rather than flat across the screen: at
   * this angle a horizontal line on screen is not a horizontal line in the
   * field, and a ruler that ignores that reports the wrong number of meters.
   */
  function drawRuler() {
    const step = rulerMeters(scale * X_AXIS_FORESHORTENING)
    const span = toCamera(step, 0, 0)
    const x = 24
    const y = height - 24

    const endX = x + span.u * scale
    const endY = y + span.v * scale

    context.strokeStyle = 'rgba(124, 118, 137, 0.7)'
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(x, y)
    context.lineTo(endX, endY)
    context.stroke()

    context.fillStyle = 'rgba(158, 151, 176, 0.9)'
    context.font = '11px "Space Mono", monospace'
    context.fillText(`${step} m`, x, y - 10)
  }

  /**
   * How far each axis runs, measured on its own. One shared reach would give a
   * field two hundred meters wide a vertical axis to match, towering over a
   * bowl thirty meters tall and reading as the most important thing on screen.
   */
  function extentOf(list: FieldPixel[]): Vector3 {
    const extent = { x: 0, y: 0, z: 0 }

    for (const { point } of list) {
      extent.x = Math.max(extent.x, Math.abs(point.x))
      extent.y = Math.max(extent.y, Math.abs(point.y))
      extent.z = Math.max(extent.z, Math.abs(point.z))
    }

    return {
      x: Math.max(extent.x * 1.12, 10),
      y: Math.max(extent.y * 1.12, 10),
      z: Math.max(extent.z * 1.12, 5),
    }
  }

  function draw() {
    context.clearRect(0, 0, width, height)
    fit(pixels)

    const extent = extentOf(pixels)
    // The flat wavefronts want one generous number, not a per-axis one: a front
    // running along y has to cross the whole field, however wide that is.
    const reach = Math.max(extent.x, extent.y)

    drawAxes(extent)
    drawEdges(edges, new Map(pixels.map(({ deviceId, point }) => [deviceId, point])))

    const placed = pixels.filter(pixel => pixel.placed)
    const center = centroid(placed.length > 0 ? placed : pixels)
    const elapsed = lastEffect ? (Date.now() - lastEffect.firedAt) / 1000 : 0

    // Far side of the bowl first, so the near stand is not drawn behind the one
    // across the pitch from it.
    const sorted = [...pixels].sort((left, right) => depthOf(right.point) - depthOf(left.point))

    for (const pixel of sorted) {
      if (!pixel.placed) {
        drawUnplaced(pixel.point)
        continue
      }

      const glow = lastEffect
        ? effectBrightness(lastEffect.effect, pixel.point, center, elapsed)
        : 0
      drawPixel(pixel.point, glow)
    }

    if (lastEffect && !reducedMotion) {
      drawWavefront(lastEffect.effect, elapsed, center, reach)
    }

    if (pixels.length > 0) drawRuler()
  }

  const observer = new ResizeObserver(() => {
    resize()
    draw()
  })
  observer.observe(canvas)

  resize()

  const tick = () => {
    draw()
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)

  return () => {
    cancelAnimationFrame(frame)
    observer.disconnect()
  }
})
</script>

<canvas bind:this={canvas} class="block h-full w-full" aria-hidden="true"></canvas>
