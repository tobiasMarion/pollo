<script lang="ts">
import { onMount } from 'svelte';
import FieldCanvas from '$lib/components/FieldCanvas.svelte';
import { type ConnectionStatus, EventConsole } from '$lib/event-console.svelte';
import { toFieldPixels } from '$lib/field';
import { formatCoordinates } from '$lib/format';

let { data } = $props();

let live = $state<EventConsole | null>(null);

const devices = $derived(live ? [...live.devices.values()] : []);
const edges = $derived(live ? [...live.edges.values()] : []);
const pixels = $derived(toFieldPixels(devices, data.event));
const unplaced = $derived(pixels.filter((pixel) => !pixel.placed).length);

const statusLabels: Record<ConnectionStatus, string> = {
  connecting: 'Connecting',
  authenticating: 'Authenticating',
  live: 'Live',
  reconnecting: 'Reconnecting',
  rejected: 'Refused',
  closed: 'Closed',
};

onMount(() => {
  if (!data.socketToken) return;

  const session = new EventConsole(data.event.id, data.socketToken);
  session.hydrate(data.graph);
  session.connect();
  live = session;

  return () => {
    session.destroy();
    live = null;
  };
});
</script>

<svelte:head>
  <title>{data.event.name} · Pollo</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col">
  <div
    class="flex flex-wrap items-center gap-x-6 gap-y-2 border-neutral-800 border-b px-5 py-3 md:px-8"
  >
    <a href="/" class="text-neutral-500 text-sm transition-colors hover:text-neutral-100">
      ← Events
    </a>

    <h1 class="font-display font-semibold text-lg">{data.event.name}</h1>

    <span class="eyebrow" data-numeric>{data.event.type}</span>

    <span class="text-neutral-500 text-xs" data-numeric>
      {formatCoordinates(data.event.latitude, data.event.longitude)}
    </span>

    <div class="ml-auto flex items-center gap-5 text-xs">
      <span class="text-neutral-500" data-numeric>
        {devices.length} device{devices.length === 1 ? '' : 's'}
      </span>
      <span class="text-neutral-500" data-numeric>{edges.length} edges</span>

      {#if live}
        <span class="flex items-center gap-2">
          <span
            class="size-2 rounded-full {live.status === 'live'
              ? 'bg-white'
              : 'ring-1 ring-neutral-500'}"
          ></span>
          <span class="text-neutral-300">{statusLabels[live.status]}</span>
        </span>
      {:else if data.event.status === 'FINISHED'}
        <span class="text-neutral-500">Finished</span>
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
    <div class="grid min-h-0 flex-1 lg:grid-cols-[1fr_18rem]">
      <section class="relative min-h-[55svh] lg:min-h-0">
        <FieldCanvas {pixels} {edges} lastEffect={live?.lastEffect ?? null} />

        {#if pixels.length === 0}
          <p
            class="pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center text-neutral-500"
          >
            {#if live?.status === 'rejected'}
              {live.error}
            {:else}
              No devices yet. Phones within about a kilometre can find this event and join.
            {/if}
          </p>
        {/if}

        {#if unplaced > 0}
          <p class="pointer-events-none absolute right-5 bottom-5 text-neutral-500 text-xs">
            <span data-numeric>{unplaced}</span> shown from GPS — outlines are devices the worker
            has not placed yet.
          </p>
        {/if}
      </section>

      <aside class="min-h-0 overflow-y-auto border-neutral-800 border-t lg:border-t-0 lg:border-l">
        <h2 class="eyebrow sticky top-0 bg-neutral-950 px-5 py-3">Devices</h2>

        {#if devices.length === 0}
          <p class="px-5 pb-5 text-neutral-500 text-sm">Nobody has joined yet.</p>
        {:else}
          <ul class="pb-5">
            {#each devices as device (device.deviceId)}
              <li class="flex items-center gap-3 px-5 py-2">
                <span
                  class="size-1.5 shrink-0 rounded-full {device.position
                    ? 'bg-white'
                    : 'ring-1 ring-neutral-500'}"
                ></span>
                <span class="flex-1 truncate text-sm" data-numeric>{device.deviceId}</span>
                {#if device.location}
                  <span class="text-neutral-500 text-xs" data-numeric>
                    ±{Math.round(device.location.horizontalAccuracy)} m
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </aside>
    </div>
  {/if}
</div>
