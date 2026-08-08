<script lang="ts">
import { type Effect, type EffectPreset, effectPresets } from '@pollo/contracts'

let {
  disabled,
  onfire,
}: {
  disabled: boolean
  onfire: (effect: Effect) => void
} = $props()

const FLASH_MS = 320

/** Which pad is lit, so a tap is visibly acknowledged even off the field. */
let flashing = $state<string | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | null = null

function fire(preset: EffectPreset) {
  if (disabled) return

  onfire(preset.effect)

  flashing = preset.id
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    flashing = null
  }, FLASH_MS)
}

/**
 * The number row, as it sits on the keyboard: 1 through 9, then 0 for the tenth
 * pad. An operator running an event has one hand on the laptop and no time to
 * aim at a target the size of a stamp — and the deck is below the fold, so for
 * most of a show these keys are the only control there is.
 */
function shortcutFor(index: number) {
  if (index < 9) return String(index + 1)
  if (index === 9) return '0'

  return undefined
}

function onkeydown(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey) return

  const target = event.target as HTMLElement | null
  if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return

  // A single digit, tested rather than coerced: `Number(' ')` is zero, and the
  // space bar has no business firing a cue.
  if (!/^[0-9]$/.test(event.key)) return

  const digit = Number(event.key)
  const preset = effectPresets[digit === 0 ? 9 : digit - 1]

  if (!preset) return

  event.preventDefault()
  fire(preset)
}
</script>

<svelte:window {onkeydown} />

<section id="cues" class="border-dusk-800 border-t px-5 py-4 md:px-8">
  <div class="flex items-baseline justify-between gap-4">
    <h2 class="eyebrow">Cues</h2>
    <p class="text-dusk-500 text-xs">
      {#if disabled}
        Waiting for the socket
      {:else}
        Tap a pad or press its number
      {/if}
    </p>
  </div>

  <div
    class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
    class:opacity-40={disabled}
  >
    {#each effectPresets as preset, index (preset.id)}
      {@const shortcut = shortcutFor(index)}
      <button
        type="button"
        onclick={() => fire(preset)}
        {disabled}
        aria-keyshortcuts={shortcut}
        class="group flex aspect-[7/5] flex-col justify-between rounded-lg border border-dusk-700 bg-dusk-900 p-3 text-left transition-colors duration-75 enabled:hover:border-dusk-600 enabled:hover:bg-dusk-800 enabled:active:bg-dusk-700 disabled:cursor-not-allowed"
        class:fired={flashing === preset.id}
      >
        <span class="flex items-baseline justify-between gap-2">
          <span class="text-[0.625rem] text-dusk-500 uppercase" data-numeric>
            {preset.effect.name}
          </span>
          {#if shortcut}
            <span class="text-[0.625rem] text-dusk-600" data-numeric>{shortcut}</span>
          {/if}
        </span>

        <span class="mt-2 font-medium leading-tight">{preset.label}</span>
        <span class="text-[0.625rem] text-dusk-500" data-numeric>{preset.hint}</span>
      </button>
    {/each}
  </div>
</section>

<style>
  /* The pad lights up like the field does: full brightness, then back. */
  .fired {
    border-color: var(--color-starlight);
    background-color: var(--color-starlight);
    color: var(--color-dusk-950);
  }

  .fired :global(span) {
    color: var(--color-dusk-950);
  }
</style>
