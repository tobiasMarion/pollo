<script lang="ts">
import {
  type Edge,
  type Effect,
  type EffectName,
  type EffectOf,
  effectBrightness,
  type Vector3,
} from '@pollo/contracts';
import { onMount } from 'svelte';
import type { FieldPixel } from '$lib/field';

/**
 * The field seen from above, in meters, relative to the event origin. This
 * is the panel: everything else on screen is a caption for it.
 */
let {
  pixels,
  edges,
  lastEffect,
}: {
  pixels: FieldPixel[];
  edges: Edge[];
  lastEffect: { effect: Effect; firedAt: number } | null;
} = $props();

let canvas: HTMLCanvasElement;

const PADDING_PX = 48;
const MIN_SCALE = 0.4;
const MAX_SCALE = 60;
const DEFAULT_SCALE = 12;

function centroid(list: FieldPixel[]): Vector3 {
  if (list.length === 0) return { x: 0, y: 0, z: 0 };

  const sum = list.reduce(
    (total, { point }) => ({
      x: total.x + point.x,
      y: total.y + point.y,
      z: total.z + point.z,
    }),
    { x: 0, y: 0, z: 0 },
  );

  return { x: sum.x / list.length, y: sum.y / list.length, z: sum.z / list.length };
}

/** A round number of meters that lands between 60 and 160 pixels. */
function rulerMeters(scale: number): number {
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  return steps.find((step) => step * scale >= 60) ?? steps[steps.length - 1];
}

onMount(() => {
  const context2d = canvas.getContext('2d');
  if (!context2d) return;

  // Bound after the guard so the draw helpers below see a non-null context.
  const context = context2d;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let width = 0;
  let height = 0;
  let frame = 0;

  // Damped so a device joining at the edge slides the field instead of
  // snapping it out from under the operator.
  let scale = DEFAULT_SCALE;
  let originX = 0;
  let originY = 0;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function fit(list: FieldPixel[]) {
    if (list.length === 0) return;

    const xs = list.map(({ point }) => point.x);
    const ys = list.map(({ point }) => point.y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);

    const usableWidth = Math.max(width - PADDING_PX * 2, 1);
    const usableHeight = Math.max(height - PADDING_PX * 2, 1);
    const target =
      spanX < 0.01 && spanY < 0.01
        ? DEFAULT_SCALE
        : Math.min(usableWidth / Math.max(spanX, 0.01), usableHeight / Math.max(spanY, 0.01));

    const center = centroid(list);

    scale += (Math.min(Math.max(target, MIN_SCALE), MAX_SCALE) - scale) * 0.06;
    originX += (center.x - originX) * 0.06;
    originY += (center.y - originY) * 0.06;
  }

  // Screen y grows downwards; north stays up.
  const toScreenX = (x: number) => width / 2 + (x - originX) * scale;
  const toScreenY = (y: number) => height / 2 - (y - originY) * scale;

  function drawEdges(list: Edge[], positions: Map<string, Vector3>) {
    context.strokeStyle = 'rgba(245, 242, 252, 0.09)';
    context.lineWidth = 1;
    context.beginPath();

    for (const edge of list) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;

      context.moveTo(toScreenX(from.x), toScreenY(from.y));
      context.lineTo(toScreenX(to.x), toScreenY(to.y));
    }

    context.stroke();
  }

  /** A device the worker has not placed yet: shown, but not as light. */
  function drawUnplaced(point: Vector3) {
    context.strokeStyle = 'rgba(158, 151, 176, 0.55)';
    context.lineWidth = 1;
    context.beginPath();
    context.arc(toScreenX(point.x), toScreenY(point.y), 3.5, 0, Math.PI * 2);
    context.stroke();
  }

  function drawPixel(point: Vector3, glow: number) {
    const x = toScreenX(point.x);
    const y = toScreenY(point.y);
    const core = 2 + glow * 1.6;
    const halo = context.createRadialGradient(x, y, 0, x, y, core * 7);

    halo.addColorStop(0, `rgba(245, 242, 252, ${0.1 + glow * 0.4})`);
    halo.addColorStop(1, 'rgba(245, 242, 252, 0)');

    context.fillStyle = halo;
    context.beginPath();
    context.arc(x, y, core * 7, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = `rgba(245, 242, 252, ${0.5 + glow * 0.5})`;
    context.beginPath();
    context.arc(x, y, core, 0, Math.PI * 2);
    context.fill();
  }

  /** A point in canvas pixels, as opposed to the meters `Vector3` carries. */
  type Vector2 = { x: number; y: number };

  const meters = (seconds: number, perUnit: number) => (perUnit > 0 ? seconds / perUnit : 0);

  /**
   * How each effect's leading edge is drawn, keyed by name rather than
   * switched on it: a new effect will not compile until it has a shape here.
   */
  const wavefrontByEffect: {
    [Name in EffectName]: (effect: EffectOf<Name>, elapsed: number, at: Vector2) => void;
  } = {
    PULSE: (effect, elapsed, { x: cx, y: cy }) => {
      const radius = meters(elapsed, effect.spreadDelayPerUnit) * scale;
      context.arc(cx, cy, radius, 0, Math.PI * 2);
    },

    WAVE: (effect, elapsed, { x: cx, y: cy }) => {
      // A vertical wave has no leading edge to draw from above.
      if (effect.direction === 'Z') return;

      const offset = meters(elapsed, effect.spreadDelayPerUnit) * scale;

      for (const sign of [-1, 1]) {
        if (effect.direction === 'X') {
          context.moveTo(cx + sign * offset, 0);
          context.lineTo(cx + sign * offset, height);
        } else {
          context.moveTo(0, cy + sign * offset);
          context.lineTo(width, cy + sign * offset);
        }
      }
    },

    ROTATE: (effect, elapsed, { x: cx, y: cy }) => {
      const angle = meters(elapsed, effect.spreadDelayPerRadian) - Math.PI;
      const reach = Math.hypot(width, height);
      context.moveTo(cx, cy);
      context.lineTo(cx + Math.cos(angle) * reach, cy - Math.sin(angle) * reach);
    },

    SPIRAL: (effect, elapsed, { x: cx, y: cy }) => {
      if (effect.radialSpeed <= 0) return;

      let started = false;

      for (let step = 0; step <= 90; step += 1) {
        const angle = (step / 90) * Math.PI * 2;
        const spent = effect.angularSpeed > 0 ? angle / effect.angularSpeed : 0;
        const radius = effect.radialSpeed * (elapsed - spent);

        // The arm has not reached this angle yet — the curve starts later.
        if (radius <= 0) continue;

        const x = cx + Math.cos(angle - Math.PI) * radius * scale;
        const y = cy - Math.sin(angle - Math.PI) * radius * scale;

        if (started) {
          context.lineTo(x, y);
        } else {
          context.moveTo(x, y);
          started = true;
        }
      }
    },
  };

  /** The cue's own geometry, so the shape of an effect is readable at a glance. */
  function drawWavefront(effect: Effect, elapsed: number, center: Vector3) {
    context.strokeStyle = 'rgba(245, 242, 252, 0.3)';
    context.lineWidth = 1.5;
    context.beginPath();

    // The record is keyed by the literal the effect is discriminated on, so
    // this pairing is sound; TypeScript cannot correlate the two on its own.
    const drawArm = wavefrontByEffect[effect.name] as (
      effect: Effect,
      elapsed: number,
      at: Vector2,
    ) => void;

    drawArm(effect, elapsed, { x: toScreenX(center.x), y: toScreenY(center.y) });

    context.stroke();
  }

  function drawRuler() {
    const meters = rulerMeters(scale);
    const length = meters * scale;
    const y = height - 24;

    context.strokeStyle = 'rgba(124, 118, 137, 0.7)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(24, y);
    context.lineTo(24 + length, y);
    context.moveTo(24, y - 4);
    context.lineTo(24, y + 4);
    context.moveTo(24 + length, y - 4);
    context.lineTo(24 + length, y + 4);
    context.stroke();

    context.fillStyle = 'rgba(158, 151, 176, 0.9)';
    context.font = '11px "Space Mono", monospace';
    context.fillText(`${meters} m`, 24, y - 10);
  }

  function draw() {
    context.clearRect(0, 0, width, height);
    fit(pixels);

    drawEdges(edges, new Map(pixels.map(({ deviceId, point }) => [deviceId, point])));

    const placed = pixels.filter((pixel) => pixel.placed);
    const center = centroid(placed.length > 0 ? placed : pixels);
    const elapsed = lastEffect ? (Date.now() - lastEffect.firedAt) / 1000 : 0;

    for (const pixel of pixels) {
      if (!pixel.placed) {
        drawUnplaced(pixel.point);
        continue;
      }

      const glow = lastEffect
        ? effectBrightness(lastEffect.effect, pixel.point, center, elapsed)
        : 0;
      drawPixel(pixel.point, glow);
    }

    if (lastEffect && !reducedMotion) {
      drawWavefront(lastEffect.effect, elapsed, center);
    }

    if (pixels.length > 0) drawRuler();
  }

  const observer = new ResizeObserver(() => {
    resize();
    draw();
  });
  observer.observe(canvas);

  resize();

  const tick = () => {
    draw();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
});
</script>

<canvas bind:this={canvas} class="block h-full w-full" aria-hidden="true"></canvas>
