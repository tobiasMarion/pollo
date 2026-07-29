<script lang="ts">
import { onMount } from 'svelte';

/** Ambient background: dim, sparse, slow. It must never compete with content. */
let { count = 70 }: { count?: number } = $props();

let canvas: HTMLCanvasElement;

interface Firefly {
  x: number;
  y: number;
  radius: number;
  periodMs: number;
  offsetMs: number;
}

function seed(): Firefly[] {
  return Array.from({ length: count }, () => ({
    x: Math.random(),
    y: Math.random(),
    radius: 1 + Math.random() * 1.8,
    periodMs: 3200 + Math.random() * 3600,
    offsetMs: Math.random() * 6000,
  }));
}

/** Fireflies blink: mostly dark, with a short rise and a slower fall. */
function brightness(fly: Firefly, elapsedMs: number): number {
  const phase = ((elapsedMs + fly.offsetMs) % fly.periodMs) / fly.periodMs;
  if (phase > 0.22) return 0;
  return Math.sin((phase / 0.22) * Math.PI) ** 2;
}

onMount(() => {
  const context = canvas.getContext('2d');
  if (!context) return;

  const flies = seed();
  const stillOnly = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let width = 0;
  let height = 0;
  let frame = 0;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw(elapsedMs: number) {
    if (!context) return;

    context.clearRect(0, 0, width, height);

    for (const fly of flies) {
      const glow = stillOnly ? 0.35 : brightness(fly, elapsedMs);
      if (glow <= 0.01) continue;

      const x = fly.x * width;
      const y = fly.y * height;
      const halo = context.createRadialGradient(x, y, 0, x, y, fly.radius * 7);

      halo.addColorStop(0, `rgba(198, 240, 74, ${0.5 * glow})`);
      halo.addColorStop(1, 'rgba(198, 240, 74, 0)');

      context.fillStyle = halo;
      context.beginPath();
      context.arc(x, y, fly.radius * 7, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = `rgba(223, 245, 143, ${0.75 * glow})`;
      context.beginPath();
      context.arc(x, y, fly.radius, 0, Math.PI * 2);
      context.fill();
    }
  }

  const observer = new ResizeObserver(() => {
    resize();
    draw(0);
  });
  observer.observe(canvas);

  resize();

  if (stillOnly) {
    draw(0);
  } else {
    const start = performance.now();
    const tick = (now: number) => {
      draw(now - start);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
});
</script>

<canvas
  bind:this={canvas}
  aria-hidden="true"
  class="pointer-events-none absolute inset-0 h-full w-full"
></canvas>
