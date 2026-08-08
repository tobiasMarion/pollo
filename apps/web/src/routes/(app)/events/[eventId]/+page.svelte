<script lang="ts">
import { onMount } from 'svelte'
import EffectDeck from '$lib/components/EffectDeck.svelte'
import FieldCanvas from '$lib/components/FieldCanvas.svelte'
import { type ConnectionStatus, EventConsole } from '$lib/event-console.svelte'
import { toFieldPixels } from '$lib/field'
import { formatCoordinates } from '$lib/format'

let { data } = $props()

let live = $state<EventConsole | null>(null)

const devices = $derived(live ? [...live.devices.values()] : [])
const edges = $derived(live ? [...live.edges.values()] : [])
const pixels = $derived(toFieldPixels(devices, data.event))
const unplaced = $derived(pixels.filter(pixel => !pixel.placed).length)

/**
 * What the field draws. The first two are worth turning off: the mesh is
 * unreadable once a crowd has thousands of edges, and the grid is scaffolding
 * rather than data.
 *
 * `unplaced` is a bench switch. A device the worker has not placed is drawn
 * from its own GPS and never lit, because an estimate shown as a pixel is an
 * estimate passed off as a measurement — but with no worker running, every
 * device is one of those, and a cue lights nothing at all. Turning it on makes
 * the panel testable against the simulator; leaving it off is the truth.
 */
const layers = $state({ edges: true, grid: true, unplaced: false })

const layerToggles = [
  { key: 'edges', label: 'Edges' },
  { key: 'grid', label: 'Grid' },
  { key: 'unplaced', label: 'Light unplaced' },
] as const satisfies ReadonlyArray<{ key: keyof typeof layers; label: string }>

const showConsole = $derived(data.isAdmin && data.event.status !== 'FINISHED')

/**
 * The deck sits below the fold, and the canvas eats the wheel to zoom — so
 * there has to be one deliberate way down that is not the scrollbar.
 */
let deck = $state<HTMLElement | null>(null)

function showCues() {
  deck?.scrollIntoView({ behavior: 'smooth', block: 'end' })
}

const statusLabels: Record<ConnectionStatus, string> = {
  connecting: 'Connecting',
  authenticating: 'Authenticating',
  live: 'Live',
  reconnecting: 'Reconnecting',
  rejected: 'Refused',
  closed: 'Closed',
}

onMount(() => {
  if (!data.socketToken) return

  const session = new EventConsole(data.event.id, data.socketToken)
  session.hydrate(data.graph)
  session.connect()
  live = session

  return () => {
    session.destroy()
    live = null
  }
})
</script>

<svelte:head>
  <title>{data.event.name} · Pollo</title>
</svelte:head>

<!--
  `h-full` and `shrink-0`: the field is worth a whole screen, so the first pane
  is exactly as tall as the scrolling area it sits in and refuses to be squeezed
  by what follows it. The cue deck is therefore below the fold — which is the
  point. It is reached by the number keys during a show, and by `showCues` when
  somebody actually wants to look at it.
-->
<div class="flex h-full min-h-0 shrink-0 flex-col">
  <div
    class="flex flex-wrap items-center gap-x-6 gap-y-2 border-dusk-800 border-b px-5 py-3 md:px-8"
  >
    <a href="/" class="text-dusk-500 text-sm transition-colors hover:text-dusk-100">
      ← Events
    </a>

    <h1 class="font-display font-semibold text-lg">{data.event.name}</h1>

    <span class="eyebrow" data-numeric>{data.event.type}</span>

    <span class="text-dusk-500 text-xs" data-numeric>
      {formatCoordinates(data.event.latitude, data.event.longitude)}
    </span>

    <div class="ml-auto flex items-center gap-5 text-xs">
      <span class="text-dusk-500" data-numeric>
        {devices.length} device{devices.length === 1 ? '' : 's'}
      </span>
      <span class="text-dusk-500" data-numeric>{edges.length} edges</span>

      {#if live}
        <span class="flex items-center gap-2">
          <span
            class="size-2 rounded-full {live.status === 'live'
              ? 'bg-starlight'
              : 'ring-1 ring-dusk-500'}"
          ></span>
          <span class="text-dusk-300">{statusLabels[live.status]}</span>
        </span>
      {:else if data.event.status === 'FINISHED'}
        <span class="text-dusk-500">Finished</span>
      {/if}
    </div>
  </div>

  {#if !data.isAdmin}
    <p class="notice m-5 md:m-8">Only the admin who opened this event can watch it.</p>
  {:else if data.event.status === 'FINISHED'}
    <p class="notice m-5 md:m-8">
      This event is finished. Its devices and distances are no longer in the runtime.
    </p>
  {:else}
    <section class="relative min-h-0 flex-1">
      <FieldCanvas
        {pixels}
        {edges}
        lastEffect={live?.lastEffect ?? null}
        showEdges={layers.edges}
        showGrid={layers.grid}
        lightUnplaced={layers.unplaced}
      />

      <div class="pointer-events-none absolute inset-x-5 top-5 flex justify-between gap-4">
        <div class="pointer-events-auto flex gap-1.5">
          {#each layerToggles as toggle (toggle.key)}
            <button
              type="button"
              aria-pressed={layers[toggle.key]}
              onclick={() => (layers[toggle.key] = !layers[toggle.key])}
              class="rounded-full border px-3 py-1 text-xs transition-colors {layers[toggle.key]
                ? 'border-dusk-600 bg-dusk-900 text-dusk-100'
                : 'border-dusk-800 text-dusk-500 hover:text-dusk-300'}"
            >
              {toggle.label}
            </button>
          {/each}
        </div>

        {#if unplaced > 0}
          <p class="text-right text-dusk-500 text-xs">
            <span data-numeric>{unplaced}</span> shown from GPS — outlines are devices the worker
            has not placed yet.
          </p>
        {/if}
      </div>

      {#if pixels.length === 0}
        <p
          class="pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center text-dusk-500"
        >
          {#if live?.status === 'rejected'}
            {live.error}
          {:else}
            No devices yet. Phones within about a kilometre can find this event and join.
          {/if}
        </p>
      {/if}

      <button
        type="button"
        onclick={showCues}
        class="-translate-x-1/2 absolute bottom-5 left-1/2 rounded-full border border-dusk-800 bg-dusk-950/80 px-4 py-1.5 text-dusk-500 text-xs backdrop-blur transition-colors hover:border-dusk-600 hover:text-dusk-200"
      >
        Cues ↓
      </button>
    </section>
  {/if}
</div>

{#if showConsole}
  <div bind:this={deck}>
    <EffectDeck disabled={live?.status !== 'live'} onfire={(effect) => live?.fireEffect(effect)} />
  </div>
{/if}
