<script lang="ts">
import type { CoordinateType, Direction, Effect, EffectName } from '$lib/api/types';

let {
  disabled,
  onfire,
}: {
  disabled: boolean;
  onfire: (effect: Effect) => void;
} = $props();

/** Kept per cue so switching tabs never loses a setting mid-event. */
let name = $state<EffectName>('PULSE');
let pulse = $state({
  coordinateType: 'RELATIVE' as CoordinateType,
  activeTime: 1.5,
  spreadDelayPerUnit: 0.02,
});
let wave = $state({
  direction: 'X' as Direction,
  activeTime: 1.5,
  spreadDelayPerUnit: 0.02,
});
let rotate = $state({ activeTime: 1.5, spreadDelayPerRadian: 0.3 });
let spiral = $state({ activeTime: 1.5, radialSpeed: 4, angularSpeed: 2 });

const cues: EffectName[] = ['PULSE', 'WAVE', 'ROTATE', 'SPIRAL'];

const descriptions: Record<EffectName, string> = {
  PULSE: 'Lights up outwards from the middle of the field.',
  WAVE: 'Sweeps along one axis.',
  ROTATE: 'Sweeps around the middle, like a radar arm.',
  SPIRAL: 'Winds outwards, turning as it goes.',
};

function build(): Effect {
  switch (name) {
    case 'PULSE':
      return { name, ...pulse };
    case 'WAVE':
      return { name, ...wave };
    case 'ROTATE':
      return { name, ...rotate };
    case 'SPIRAL':
      return { name, ...spiral };
  }
}

let firedAt = $state<number | null>(null);

function fire() {
  onfire(build());
  firedAt = Date.now();
}

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
</script>

<section class="border-neutral-800 border-b px-5 py-4">
  <h2 class="eyebrow">Cue</h2>

  <div class="mt-3 grid grid-cols-4 gap-px bg-neutral-800">
    {#each cues as cue (cue)}
      <button
        type="button"
        onclick={() => (name = cue)}
        aria-pressed={name === cue}
        class="bg-neutral-950 py-2 text-[0.6875rem] tracking-wider transition-colors hover:bg-neutral-900 aria-pressed:bg-neutral-200 aria-pressed:text-neutral-950"
        data-numeric
      >
        {cue}
      </button>
    {/each}
  </div>

  <p class="mt-3 text-neutral-500 text-xs">{descriptions[name]}</p>

  <div class="mt-4 flex flex-col gap-3">
    {#if name === 'PULSE'}
      <label class="flex items-center justify-between gap-3 text-sm">
        <span class="text-neutral-400">Frame</span>
        <select
          bind:value={pulse.coordinateType}
          class="border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs"
          data-numeric
        >
          <option value="RELATIVE">RELATIVE</option>
          <option value="ABSOLUTE">ABSOLUTE</option>
        </select>
      </label>

      <label class="flex items-center justify-between gap-3 text-sm">
        <span class="text-neutral-400">Lit for <span class="text-neutral-500">s</span></span>
        <input
          type="number"
          bind:value={pulse.activeTime}
          min="0"
          step="0.1"
          class="w-20 border border-neutral-800 bg-neutral-900 px-2 py-1 text-right text-xs"
          data-numeric
        />
      </label>

      <label class="flex items-center justify-between gap-3 text-sm">
        <span class="text-neutral-400">Spread <span class="text-neutral-500">s/m</span></span>
        <input
          type="number"
          bind:value={pulse.spreadDelayPerUnit}
          min="0"
          step="0.005"
          class="w-20 border border-neutral-800 bg-neutral-900 px-2 py-1 text-right text-xs"
          data-numeric
        />
      </label>
    {:else if name === 'WAVE'}
      <label class="flex items-center justify-between gap-3 text-sm">
        <span class="text-neutral-400">Axis</span>
        <select
          bind:value={wave.direction}
          class="border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs"
          data-numeric
        >
          <option value="X">X — east</option>
          <option value="Y">Y — north</option>
          <option value="Z">Z — up</option>
        </select>
      </label>

      <label class="flex items-center justify-between gap-3 text-sm">
        <span class="text-neutral-400">Lit for <span class="text-neutral-500">s</span></span>
        <input
          type="number"
          bind:value={wave.activeTime}
          min="0"
          step="0.1"
          class="w-20 border border-neutral-800 bg-neutral-900 px-2 py-1 text-right text-xs"
          data-numeric
        />
      </label>

      <label class="flex items-center justify-between gap-3 text-sm">
        <span class="text-neutral-400">Spread <span class="text-neutral-500">s/m</span></span>
        <input
          type="number"
          bind:value={wave.spreadDelayPerUnit}
          min="0"
          step="0.005"
          class="w-20 border border-neutral-800 bg-neutral-900 px-2 py-1 text-right text-xs"
          data-numeric
        />
      </label>
    {:else if name === 'ROTATE'}
      <label class="flex items-center justify-between gap-3 text-sm">
        <span class="text-neutral-400">Lit for <span class="text-neutral-500">s</span></span>
        <input
          type="number"
          bind:value={rotate.activeTime}
          min="0"
          step="0.1"
          class="w-20 border border-neutral-800 bg-neutral-900 px-2 py-1 text-right text-xs"
          data-numeric
        />
      </label>

      <label class="flex items-center justify-between gap-3 text-sm">
        <span class="text-neutral-400">Spread <span class="text-neutral-500">s/rad</span></span>
        <input
          type="number"
          bind:value={rotate.spreadDelayPerRadian}
          min="0"
          step="0.05"
          class="w-20 border border-neutral-800 bg-neutral-900 px-2 py-1 text-right text-xs"
          data-numeric
        />
      </label>
    {:else}
      <label class="flex items-center justify-between gap-3 text-sm">
        <span class="text-neutral-400">Lit for <span class="text-neutral-500">s</span></span>
        <input
          type="number"
          bind:value={spiral.activeTime}
          min="0"
          step="0.1"
          class="w-20 border border-neutral-800 bg-neutral-900 px-2 py-1 text-right text-xs"
          data-numeric
        />
      </label>

      <label class="flex items-center justify-between gap-3 text-sm">
        <span class="text-neutral-400">Outwards <span class="text-neutral-500">m/s</span></span>
        <input
          type="number"
          bind:value={spiral.radialSpeed}
          min="0"
          step="0.5"
          class="w-20 border border-neutral-800 bg-neutral-900 px-2 py-1 text-right text-xs"
          data-numeric
        />
      </label>

      <label class="flex items-center justify-between gap-3 text-sm">
        <span class="text-neutral-400">Turning <span class="text-neutral-500">rad/s</span></span>
        <input
          type="number"
          bind:value={spiral.angularSpeed}
          min="0"
          step="0.5"
          class="w-20 border border-neutral-800 bg-neutral-900 px-2 py-1 text-right text-xs"
          data-numeric
        />
      </label>
    {/if}
  </div>

  <button
    type="button"
    onclick={fire}
    {disabled}
    class="mt-4 w-full bg-neutral-200 py-2.5 font-medium text-neutral-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
  >
    Fire {name}
  </button>

  <p class="mt-2 h-4 text-neutral-500 text-xs" data-numeric>
    {#if disabled}
      Waiting for the socket
    {:else if firedAt}
      Last fired {timeFormatter.format(firedAt)}
    {/if}
  </p>
</section>
