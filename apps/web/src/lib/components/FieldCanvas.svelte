<script lang="ts">
import {
  type Edge,
  type Effect,
  type EffectName,
  type EffectOf,
  effectBrightness,
  type Vector3,
  vector,
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
  showEdges = true,
  showGrid = true,
  lightUnplaced = false,
}: {
  pixels: FieldPixel[]
  edges: Edge[]
  lastEffect: { effect: Effect; firedAt: number } | null
  showEdges?: boolean
  showGrid?: boolean
  /**
   * Let a cue reach the devices the worker has not placed. Off by default,
   * because their positions are GPS guesses metres wide — but until a worker
   * exists, they are the only devices there are, and a panel where no cue ever
   * lights anything cannot be judged at all.
   */
  lightUnplaced?: boolean
} = $props()

let canvas: HTMLCanvasElement

const PADDING_PX = 48
const MIN_SCALE = 0.4
const MAX_SCALE = 60
const DEFAULT_SCALE = 12

/**
 * The yaw is deliberately not 45°, which would put a corner of the bowl square
 * to the viewer and make the two halves mirror each other; off the diagonal,
 * one straight side reads as the near stand and the shape is legible.
 *
 * The pitch has to clear the rake of the stands, and by more than a little. A
 * lower tier rising 0.45m every 0.8m of depth is a slope of 29.4°: walking
 * outward on the side facing the camera moves a row away (down the screen by
 * sin(pitch)) and up (up the screen by rake·cos(pitch)), and at 29.4° those
 * cancel exactly. Below it the viewer is under the seating surface looking at
 * its underside; just above it the stand is near enough edge-on that the bowl
 * reads inside out. 50° puts the near rows a clear third of a metre down-screen
 * per metre outward, which is unambiguously looking into the bowl, while still
 * leaving the height foreshortened enough to see.
 */
const DEFAULT_YAW = (32 * Math.PI) / 180
const DEFAULT_PITCH = (50 * Math.PI) / 180

/** Never quite overhead and never underground: both are disorienting. */
const MIN_PITCH = (6 * Math.PI) / 180
const MAX_PITCH = (88 * Math.PI) / 180

const ORBIT_PER_PIXEL = 0.006
const ORBIT_PER_KEYPRESS = 0.06
const ZOOM_PER_NOTCH = 1.0015

/**
 * How big a person is, in meters — so a dot is sized from the field rather than
 * from the screen.
 *
 * A fixed pixel radius is what makes a crowd read as a smear. Seats are half a
 * metre apart, and at the zoom that fits a stadium that is a couple of pixels
 * between neighbours; anything drawn at a constant three or four pixels
 * therefore overlaps its neighbours several deep and the shape of the stand
 * disappears into a solid band. Tying the radius to the scale keeps the gap
 * between two people visible at every zoom, which is the whole point of drawing
 * them separately.
 */
const PERSON_RADIUS_M = 0.2

/** Below this a dot is invisible; above it a crowd is a blanket. */
const MIN_DOT_PX = 0.7
const MAX_DOT_PX = 4

/** How much a lit pixel swells. Kept small, or the field solidifies on a cue. */
const GLOW_SWELL = 0.6

/** How far a halo reaches past its own dot, and how hard it burns at full glow. */
const HALO_SPREAD = 6
const HALO_PEAK = 0.75

/**
 * How much of a cue an unplaced device takes, when they are lit at all. A
 * fraction rather than all of it: the light says where the wave is, and the
 * dimness says the panel is guessing.
 */
const UNPLACED_GLOW = 0.4

/**
 * How much of the frame a re-framing move aims to fill. Short of the padding on
 * purpose: the slack it leaves is the room the crowd then has to move in
 * without the camera following it.
 */
const REFRAME_FILL = 0.72

/** Below this the crowd has drifted far enough into a corner to come back for. */
const REFRAME_MIN_FILL = 0.3

/**
 * How far the middle of a crowd too big for the frame may wander before the
 * camera goes after it, as a fraction of the half-frame.
 */
const STRAY_REACH = 0.35

/** Per frame, so a re-frame glides rather than cuts. */
const REFRAME_EASE = 0.06

/** A point in canvas pixels, as opposed to the meters `Vector3` carries. */
type Vector2 = { x: number; y: number }

function centroid(list: FieldPixel[]): Vector3 {
  return vector.centroid(list.map(pixel => pixel.point))
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

  let yaw = DEFAULT_YAW
  let pitch = DEFAULT_PITCH

  let cosYaw = Math.cos(yaw)
  let sinYaw = Math.sin(yaw)
  let cosPitch = Math.cos(pitch)
  let sinPitch = Math.sin(pitch)

  /**
   * Set once the operator zooms. Until then the view keeps framing itself, and
   * after it the framing stays where it was put — an auto-fit that overrode a
   * deliberate zoom every frame would be unusable.
   */
  let chosenScale: number | null = null

  /**
   * Whether the camera is currently moving to a new framing. It starts true so
   * the first crowd to arrive is framed rather than met with the default zoom.
   */
  let reframing = true

  function orbit(byYaw: number, byPitch: number) {
    yaw += byYaw
    pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, pitch + byPitch))

    cosYaw = Math.cos(yaw)
    sinYaw = Math.sin(yaw)
    cosPitch = Math.cos(pitch)
    sinPitch = Math.sin(pitch)
  }

  function resetCamera() {
    yaw = DEFAULT_YAW
    pitch = DEFAULT_PITCH
    chosenScale = null

    // Reset means "put it back the way it was", and the way it was includes the
    // crowd being framed — otherwise a reset from a corner leaves it there.
    reframing = true

    orbit(0, 0)
  }

  /** Camera-space coordinates of a field offset, before scale and centering. */
  function toCamera(dx: number, dy: number, dz: number) {
    const east = dx * cosYaw - dy * sinYaw
    const north = dx * sinYaw + dy * cosYaw

    return {
      u: east,
      v: -(north * sinPitch + dz * cosPitch),
      /** Distance along the view direction — larger is further from the camera. */
      depth: north * cosPitch - dz * sinPitch,
    }
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1
    width = canvas.clientWidth
    height = canvas.clientHeight
    canvas.width = width * ratio
    canvas.height = height * ratio
    context.setTransform(ratio, 0, 0, ratio, 0, 0)

    // The frame changed shape under the crowd, so whatever framing it had is no
    // longer the one it was given.
    reframing = true
  }

  /**
   * The framing, measured against the camera as it stands rather than against
   * the crowd's own bounds: what matters is where the crowd currently falls on
   * screen.
   */
  function framing(list: FieldPixel[]) {
    // Measured on the projected shape, not on the x/y spans: at this angle a
    // tall bowl and a flat one of the same footprint need different zoom.
    let minU = Number.POSITIVE_INFINITY
    let maxU = Number.NEGATIVE_INFINITY
    let minV = Number.POSITIVE_INFINITY
    let maxV = Number.NEGATIVE_INFINITY

    for (const { point } of list) {
      const { u, v } = toCamera(point.x - originX, point.y - originY, point.z - originZ)

      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }

    const usableWidth = Math.max(width - PADDING_PX * 2, 1)
    const usableHeight = Math.max(height - PADDING_PX * 2, 1)

    // How far the crowd reaches from the middle of the frame, as a fraction of
    // the half-frame: 1 is exactly touching the padding.
    const reach = Math.max(
      (Math.max(maxU, -minU) * scale) / (usableWidth / 2),
      (Math.max(maxV, -minV) * scale) / (usableHeight / 2),
    )

    return {
      spanU: maxU - minU,
      spanV: maxV - minV,
      usableWidth,
      usableHeight,
      reach,
      /** How much of the frame the crowd fills, ignoring where it sits in it. */
      fill: Math.max(((maxU - minU) * scale) / usableWidth, ((maxV - minV) * scale) / usableHeight),
    }
  }

  /**
   * Re-frame the crowd — but only when it has actually gone somewhere.
   *
   * Chasing the centroid every frame is what makes the panel unreadable: a
   * crowd is never still, so a camera that tracks it exactly is a camera that
   * never stops moving, and the viewer cannot tell whether the field drifted or
   * the lens did. So the framing is left alone while the crowd stays inside it,
   * and a move is only started when the crowd reaches the padding or has shrunk
   * into a corner of the frame.
   *
   * Once started, the move aims at `REFRAME_FILL` rather than at the edge, so
   * it lands with room to spare and does not immediately trip the same test
   * again — a threshold to leave and a different one to arrive, which is the
   * only arrangement that settles.
   */
  function fit(list: FieldPixel[]) {
    if (list.length === 0) return

    const view = framing(list)

    if (!reframing) {
      // A crowd held bigger than the frame can never sit inside it, so testing
      // its edges would re-frame forever — but that is only a state the
      // operator can put it in, by zooming in. Left to itself, a crowd that
      // outgrows its framing is precisely what a re-frame is for.
      const zoomedIn = chosenScale !== null && view.fill > 1

      const escaped = zoomedIn ? view.reach - view.fill > STRAY_REACH : view.reach > 1
      const lost = chosenScale === null && view.fill < REFRAME_MIN_FILL

      if (!escaped && !lost) return

      reframing = true
    }

    const center = centroid(list)

    const target =
      view.spanU < 0.01 && view.spanV < 0.01
        ? DEFAULT_SCALE
        : Math.min(
            (view.usableWidth * REFRAME_FILL) / Math.max(view.spanU, 0.01),
            (view.usableHeight * REFRAME_FILL) / Math.max(view.spanV, 0.01),
          )

    const wanted = chosenScale ?? Math.min(Math.max(target, MIN_SCALE), MAX_SCALE)

    scale += (wanted - scale) * REFRAME_EASE
    originX += (center.x - originX) * REFRAME_EASE
    originY += (center.y - originY) * REFRAME_EASE
    originZ += (center.z - originZ) * REFRAME_EASE

    // Arrived: the zoom is where it was going and the crowd is centred to
    // within a fraction of its own size. The crowd keeps moving, so this can
    // never be an exact test.
    const settled =
      Math.abs(wanted - scale) < wanted * 0.01 &&
      Math.hypot(center.x - originX, center.y - originY, center.z - originZ) <
        Math.max(view.spanU, view.spanV) * 0.02 + 0.01

    if (settled) reframing = false
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

  /**
   * The halo, rendered once into its own canvas and stamped from there.
   *
   * A gradient per pixel per frame is a gradient object built, and thrown away,
   * a hundred thousand times a second at the scale this panel has to survive —
   * and every one of them is identical apart from where it sits.
   */
  const HALO_RADIUS_PX = 32

  const halo = (() => {
    const sprite = document.createElement('canvas')
    sprite.width = HALO_RADIUS_PX * 2
    sprite.height = HALO_RADIUS_PX * 2

    const spriteContext = sprite.getContext('2d')
    if (!spriteContext) return sprite

    const gradient = spriteContext.createRadialGradient(
      HALO_RADIUS_PX,
      HALO_RADIUS_PX,
      0,
      HALO_RADIUS_PX,
      HALO_RADIUS_PX,
      HALO_RADIUS_PX,
    )

    // Falloff, not a ramp. A linear gradient still has half its alpha left at
    // half its radius, which is a disc of fog with a bright middle; light from a
    // point drops off far faster than that, so most of the sprite is nearly
    // nothing and only the core carries.
    gradient.addColorStop(0, 'rgba(245, 242, 252, 1)')
    gradient.addColorStop(0.12, 'rgba(245, 242, 252, 0.55)')
    gradient.addColorStop(0.3, 'rgba(245, 242, 252, 0.16)')
    gradient.addColorStop(0.6, 'rgba(245, 242, 252, 0.03)')
    gradient.addColorStop(1, 'rgba(245, 242, 252, 0)')

    spriteContext.fillStyle = gradient
    spriteContext.fillRect(0, 0, sprite.width, sprite.height)

    return sprite
  })()

  /**
   * Cores are stamped in bands of brightness rather than one at a time.
   *
   * Canvas cannot vary a fill colour within a path, so a per-pixel alpha means
   * a `fill()` per pixel — thousands of state changes a frame, which is where
   * the time actually goes. Rounding the brightness to eight bands costs
   * nothing anyone can see and turns that into eight fills.
   */
  const BRIGHTNESS_BANDS = 8

  /** A person's footprint at the current zoom, in canvas pixels. */
  function dotRadius(glow: number) {
    const metres = PERSON_RADIUS_M * (1 + glow * GLOW_SWELL)

    return Math.min(MAX_DOT_PX, Math.max(MIN_DOT_PX, metres * scale))
  }

  function drawCrowd(list: FieldPixel[], center: Vector3, elapsed: number, now: number) {
    const bands: Vector2[][] = Array.from({ length: BRIGHTNESS_BANDS + 1 }, () => [])
    const outlineBands: Vector2[][] = Array.from({ length: BRIGHTNESS_BANDS + 1 }, () => [])
    const glows: Array<{ at: Vector2; glow: number }> = []

    for (const pixel of list) {
      const at = project(interpolate(pixel, now))

      const lit = pixel.placed || lightUnplaced
      const glow =
        lastEffect && lit
          ? effectBrightness(lastEffect.effect, pixel.point, center, elapsed) *
            (pixel.placed ? 1 : UNPLACED_GLOW)
          : 0

      const band = Math.round(glow * BRIGHTNESS_BANDS)

      if (pixel.placed) bands[band]?.push(at)
      else outlineBands[band]?.push(at)

      // Below this a halo is a sprite the size of a thumbnail carrying almost
      // no light, and there can be thousands of them at once.
      if (glow > 0.08) glows.push({ at, glow })
    }

    // Halos first, so a lit pixel's core is not washed out by its neighbour's
    // glow. Only lit pixels have one, so a field at rest pays nothing for this.
    //
    // `lighter` because this is light, and light adds. Painted the usual way,
    // each halo *replaces* a share of what is under it with its own white, so a
    // hundred overlapping ones converge on flat white — the crowd goes milky
    // instead of bright, and the brightest place on the field looks the same as
    // the dimmest. Adding, two half-lit pixels make one brighter one, and a
    // crowd that is not lit contributes nothing at all.
    context.globalCompositeOperation = 'lighter'

    for (const { at, glow } of glows) {
      const radius = dotRadius(glow) * HALO_SPREAD

      // No floor under this: an alpha that starts at 0.1 means the faintest
      // edge of a pass still lays a wide veil over everything it touches, which
      // is fog. Squared, the leading edge is a rumour and the peak is the event.
      context.globalAlpha = glow * glow * HALO_PEAK
      context.drawImage(halo, at.x - radius, at.y - radius, radius * 2, radius * 2)
    }

    context.globalCompositeOperation = 'source-over'
    context.globalAlpha = 1

    for (let band = 0; band < bands.length; band++) {
      const points = bands[band]
      if (!points || points.length === 0) continue

      const glow = band / BRIGHTNESS_BANDS
      const core = dotRadius(glow)

      // A dot this small is mostly anti-aliasing, so most of its area arrives
      // at partial coverage; the resting alpha has to be high or a crowd at
      // stadium zoom fades to nothing.
      context.fillStyle = `rgba(245, 242, 252, ${0.78 + glow * 0.22})`
      context.beginPath()

      for (const { x, y } of points) {
        context.moveTo(x + core, y)
        context.arc(x, y, core, 0, Math.PI * 2)
      }

      context.fill()
    }

    // Devices the worker has not placed stay outlines whatever else happens to
    // them: an estimate drawn as a pixel is an estimate the panel is passing off
    // as a measurement. Wider than a placed pixel so the ring is still a ring —
    // at stadium zoom the two are a pixel apart and barely distinguishable,
    // which zooming in fixes and nothing else can.
    for (let band = 0; band < outlineBands.length; band++) {
      const points = outlineBands[band]
      if (!points || points.length === 0) continue

      const glow = band / BRIGHTNESS_BANDS
      const ring = Math.max(dotRadius(glow) * 1.6, 1.4)

      context.strokeStyle = `rgba(158, 151, 176, ${0.55 + glow * 0.45})`
      context.lineWidth = Math.min(1, ring)
      context.beginPath()

      for (const { x, y } of points) {
        context.moveTo(x + ring, y)
        context.arc(x, y, ring, 0, Math.PI * 2)
      }

      context.stroke()
    }
  }

  /**
   * Where a pixel is right now, between the batch that moved it and the next.
   * Without this the whole crowd would step once a second.
   */
  function interpolate(pixel: FieldPixel, now: number): Vector3 {
    if (pixel.window <= 0) return pixel.point

    const progress = Math.min(1, Math.max(0, (now - pixel.since) / pixel.window))
    if (progress >= 1) return pixel.point

    return vector.lerp(pixel.from, pixel.point, progress)
  }

  /**
   * Where every pixel is *right now*, keyed by device.
   *
   * An edge has to be read off the same clock as the two dots it joins. Built
   * from the settled positions it would snap to the far end of a move while the
   * crowd was still gliding there — the mesh arriving a batch ahead of the
   * people, and visibly detached from them on the way.
   *
   * The map is reused rather than rebuilt: a crowd of twenty thousand is a map
   * and an array per frame otherwise.
   */
  const livePositions = new Map<string, Vector3>()

  function positionsAt(now: number) {
    livePositions.clear()

    for (const pixel of pixels) livePositions.set(pixel.deviceId, interpolate(pixel, now))

    return livePositions
  }

  /**
   * The ground plane, ruled at whatever spacing the ruler is using, so the
   * crowd has something to sit on rather than floating in the dark.
   */
  function drawGrid(extent: Vector3) {
    const foreshortening = Math.hypot(cosYaw, sinYaw * sinPitch)
    const step = rulerMeters(scale * foreshortening)

    const reachX = Math.ceil(extent.x / step) * step
    const reachY = Math.ceil(extent.y / step) * step

    context.strokeStyle = 'rgba(158, 151, 176, 0.06)'
    context.lineWidth = 1
    context.beginPath()

    for (let x = -reachX; x <= reachX; x += step) {
      const a = project({ x, y: -reachY, z: 0 })
      const b = project({ x, y: reachY, z: 0 })
      context.moveTo(a.x, a.y)
      context.lineTo(b.x, b.y)
    }

    for (let y = -reachY; y <= reachY; y += step) {
      const a = project({ x: -reachX, y, z: 0 })
      const b = project({ x: reachX, y, z: 0 })
      context.moveTo(a.x, a.y)
      context.lineTo(b.x, b.y)
    }

    context.stroke()
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
    // How much a meter along x is worth on screen, at the angle it is currently
    // being seen from.
    const foreshortening = Math.hypot(cosYaw, sinYaw * sinPitch)
    const step = rulerMeters(scale * foreshortening)
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

    const now = Date.now()

    if (showGrid) drawGrid(extent)
    drawAxes(extent)

    if (showEdges) drawEdges(edges, positionsAt(now))

    const placed = pixels.filter(pixel => pixel.placed)
    const center = centroid(placed.length > 0 ? placed : pixels)
    const elapsed = lastEffect ? (now - lastEffect.firedAt) / 1000 : 0

    // Far side of the bowl first, so the near stand is not drawn behind the one
    // across the pitch from it. Sorted on the settled position rather than the
    // interpolated one: re-sorting every frame while the crowd glides would
    // make pixels flicker past each other for no visible gain.
    const sorted = [...pixels].sort((left, right) => depthOf(right.point) - depthOf(left.point))

    drawCrowd(sorted, center, elapsed, now)

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

  /**
   * Orbit by dragging, and by the arrow keys on the same model: the gesture
   * moves the *field*, not the camera. Drag right and the bowl turns right;
   * drag down and its far side tips up toward you, which ends at looking
   * straight down.
   *
   * The camera model — where dragging down lowers the viewpoint — is the other
   * defensible reading, and it is the wrong one here: reaching for a plan view
   * by pulling the field toward you is what everybody tries first, and getting
   * the horizon instead leaves the useful half of the range unreachable without
   * discovering that the gesture is inverted.
   */
  let dragging: number | null = null
  let lastX = 0
  let lastY = 0

  const onPointerDown = (event: PointerEvent) => {
    dragging = event.pointerId
    lastX = event.clientX
    lastY = event.clientY
    canvas.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (dragging !== event.pointerId) return

    orbit(-(event.clientX - lastX) * ORBIT_PER_PIXEL, (event.clientY - lastY) * ORBIT_PER_PIXEL)

    lastX = event.clientX
    lastY = event.clientY
  }

  const onPointerUp = (event: PointerEvent) => {
    if (dragging !== event.pointerId) return

    dragging = null
    canvas.releasePointerCapture(event.pointerId)
  }

  const onWheel = (event: WheelEvent) => {
    event.preventDefault()

    const next = (chosenScale ?? scale) * ZOOM_PER_NOTCH ** -event.deltaY
    chosenScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))

    // Applied here rather than eased into by the framing: a wheel notch is
    // already a small step, and the framing now holds still most of the time —
    // waiting for it would mean a wheel that does nothing.
    scale = chosenScale
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const step = ORBIT_PER_KEYPRESS

    switch (event.key) {
      case 'ArrowLeft':
        orbit(step, 0)
        break
      case 'ArrowRight':
        orbit(-step, 0)
        break
      case 'ArrowUp':
        orbit(0, -step)
        break
      case 'ArrowDown':
        orbit(0, step)
        break
      // Not a number key: the whole numeric row belongs to the cue pads, and an
      // operator who fires a cue with the field focused must not also have the
      // camera jump.
      case 'r':
      case 'R':
        resetCamera()
        break
      default:
        return
    }

    event.preventDefault()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('keydown', onKeyDown)
  canvas.addEventListener('dblclick', resetCamera)

  resize()

  const tick = () => {
    draw()
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)

  return () => {
    cancelAnimationFrame(frame)
    observer.disconnect()

    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('keydown', onKeyDown)
    canvas.removeEventListener('dblclick', resetCamera)
  }
})
</script>

<canvas
  bind:this={canvas}
  class="block h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
  tabindex="0"
  aria-label="The field seen from a raised corner. Drag or use the arrow keys to orbit, scroll to zoom, double-click or press R to reset."
></canvas>
