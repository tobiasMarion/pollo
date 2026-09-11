<script lang="ts">
import { type Edge, type Effect, effectBrightness } from '@pollo/contracts'
import { type Vector3, vector } from '@pollo/geometry'
import { onMount } from 'svelte'
import type { FieldPixel } from '$lib/field'
import { type CanvasPoint, FieldCamera } from './field-camera'
import { drawWavefront } from './field-wavefront'

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
  lastEffect: { effect: Effect; firedAt: number; center: Vector3 } | null
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

const ORBIT_PER_PIXEL = 0.006
const ORBIT_PER_KEYPRESS = 0.06

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
 * A phone that is switched off, and the light it gives when it is on.
 *
 * These are two colours rather than two opacities of one, and that is the whole
 * point of them. A dot at this size is mostly anti-aliasing, so a resting pixel
 * has to stay near-opaque or a crowd at stadium zoom dissolves — which leaves
 * opacity with almost no range to say anything with. Drawn as white either way,
 * a dark field and a lit one differ by a fifth of an alpha channel, and the
 * crowd reads as permanently on: the wave has nothing to arrive *into*.
 *
 * Cold and dim against warm and bright is a difference the eye takes as a
 * change of state rather than a change of degree. Rest is also desaturated
 * towards blue, where a screen has the least gamut, so a hundred of them beside
 * each other still read as one dark surface.
 */
const REST_COLOR = { r: 96, g: 106, b: 138 }
const LIT_COLOR = { r: 245, g: 242, b: 252 }

/** The same, for a device the worker has not placed: lighter, and never a pixel. */
const OUTLINE_REST = { r: 158, g: 151, b: 176 }

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
  const camera = new FieldCamera()

  function resize() {
    const ratio = window.devicePixelRatio || 1
    width = canvas.clientWidth
    height = canvas.clientHeight
    canvas.width = width * ratio
    canvas.height = height * ratio
    context.setTransform(ratio, 0, 0, ratio, 0, 0)

    camera.resize(width, height)
  }

  const project = (point: Vector3) => camera.project(point)
  const resetCamera = () => camera.reset()

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

  /**
   * What a pixel is painted with at a given glow: its resting colour, crossed
   * towards the field's light. Alpha is passed separately because it is doing a
   * different job — keeping a sub-pixel dot solid enough to see at all.
   */
  function pixelColor(glow: number, alpha: number, rest: typeof REST_COLOR) {
    const mix = (from: number, to: number) => Math.round(from + (to - from) * glow)

    return `rgba(${mix(rest.r, LIT_COLOR.r)}, ${mix(rest.g, LIT_COLOR.g)}, ${mix(rest.b, LIT_COLOR.b)}, ${alpha})`
  }

  /** A person's footprint at the current zoom, in canvas pixels. */
  function dotRadius(glow: number) {
    const metres = PERSON_RADIUS_M * (1 + glow * GLOW_SWELL)

    return Math.min(MAX_DOT_PX, Math.max(MIN_DOT_PX, metres * camera.scale))
  }

  function drawCrowd(list: FieldPixel[], center: Vector3, elapsed: number, now: number) {
    const bands: CanvasPoint[][] = Array.from({ length: BRIGHTNESS_BANDS + 1 }, () => [])
    const outlineBands: CanvasPoint[][] = Array.from({ length: BRIGHTNESS_BANDS + 1 }, () => [])
    const glows: Array<{ at: CanvasPoint; glow: number }> = []

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
      // at partial coverage; the alpha has to stay high or a crowd at stadium
      // zoom fades to nothing. Which is why the state is carried by the colour:
      // see REST_COLOR.
      context.fillStyle = pixelColor(glow, 0.86 + glow * 0.14, REST_COLOR)
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

      // Same crossing, from its own resting colour: whatever an outline is, lit
      // has to mean the one thing everywhere on this canvas.
      context.strokeStyle = pixelColor(glow, 0.55 + glow * 0.45, OUTLINE_REST)
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
    const step = rulerMeters(camera.scale * camera.xForeshortening)

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

  /**
   * Drawn along the projected x axis rather than flat across the screen: at
   * this angle a horizontal line on screen is not a horizontal line in the
   * field, and a ruler that ignores that reports the wrong number of meters.
   */
  function drawRuler() {
    // How much a meter along x is worth on screen, at the angle it is currently
    // being seen from.
    const step = rulerMeters(camera.scale * camera.xForeshortening)
    const span = camera.toCamera(step, 0, 0)
    const x = 24
    const y = height - 24

    const endX = x + span.u * camera.scale
    const endY = y + span.v * camera.scale

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
    camera.fit(pixels)

    const extent = extentOf(pixels)
    // The flat wavefronts want one generous number, not a per-axis one: a front
    // running along y has to cross the whole field, however wide that is.
    const reach = Math.max(extent.x, extent.y)

    const now = Date.now()

    if (showGrid) drawGrid(extent)
    drawAxes(extent)

    if (showEdges) drawEdges(edges, positionsAt(now))

    // The centre rides along with the cue rather than being worked out here: the
    // API measures it across the whole field, and a panel drawing a pass from a
    // centre of its own is a panel showing something the crowd is not doing.
    const center = lastEffect?.center ?? vector.ZERO
    const elapsed = lastEffect ? (now - lastEffect.firedAt) / 1000 : 0

    // Far side of the bowl first, so the near stand is not drawn behind the one
    // across the pitch from it. Sorted on the settled position rather than the
    // interpolated one: re-sorting every frame while the crowd glides would
    // make pixels flicker past each other for no visible gain.
    const sorted = [...pixels].sort(
      (left, right) => camera.depthOf(right.point) - camera.depthOf(left.point),
    )

    drawCrowd(sorted, center, elapsed, now)

    if (lastEffect && !reducedMotion) {
      drawWavefront(context, lastEffect.effect, elapsed, center, reach, camera.scale, project)
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

    camera.orbit(
      -(event.clientX - lastX) * ORBIT_PER_PIXEL,
      (event.clientY - lastY) * ORBIT_PER_PIXEL,
    )

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

    camera.zoom(event.deltaY)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const step = ORBIT_PER_KEYPRESS

    switch (event.key) {
      case 'ArrowLeft':
        camera.orbit(step, 0)
        break
      case 'ArrowRight':
        camera.orbit(-step, 0)
        break
      case 'ArrowUp':
        camera.orbit(0, -step)
        break
      case 'ArrowDown':
        camera.orbit(0, step)
        break
      // Not a number key: the whole numeric row belongs to the cue pads, and an
      // operator who fires a cue with the field focused must not also have the
      // camera jump.
      case 'r':
      case 'R':
        camera.reset()
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
