<script lang="ts">
import { untrack } from 'svelte';
import { enhance } from '$app/forms';
import { formatCoordinates, formatTimestamp } from '$lib/format';

let { data, form } = $props();

// Seeded from the action result for the no-JavaScript path, where the page
// comes back fresh. Under `enhance` the component survives a failed submit
// and these already hold what the operator typed — do not overwrite them.
let latitude = $state(untrack(() => form?.latitude) ?? '');
let longitude = $state(untrack(() => form?.longitude) ?? '');
let locating = $state(false);
let locationError = $state('');

/** The operator is usually standing on the spot the event radiates from. */
function useMyLocation() {
  locating = true;
  locationError = '';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      latitude = position.coords.latitude.toFixed(5);
      longitude = position.coords.longitude.toFixed(5);
      locating = false;
    },
    () => {
      locationError = 'Your browser would not share a location. Type the coordinates instead.';
      locating = false;
    },
    { enableHighAccuracy: true, timeout: 10_000 },
  );
}
</script>

<svelte:head>
  <title>Events · Pollo</title>
</svelte:head>

<div
  class="mx-auto grid w-full max-w-6xl flex-1 gap-10 px-5 py-10 md:px-8 lg:grid-cols-[1fr_20rem]"
>
  <section>
    <div class="flex items-baseline justify-between">
      <h1 class="eyebrow">Your events</h1>
      <span class="text-mist-500 text-xs" data-numeric>{data.events.length}</span>
    </div>

    {#if data.events.length === 0}
      <p class="mt-4 border border-night-700 px-4 py-8 text-center text-mist-400">
        No events yet. Open one and the phones nearby can find it.
      </p>
    {:else}
      <ul class="mt-4 border-night-700 border-t">
        {#each data.events as event (event.id)}
          <li class="border-night-700 border-b">
            <a
              href="/events/{event.id}"
              class="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 px-2 py-3.5 transition-colors hover:bg-night-900 sm:grid-cols-[auto_1fr_5rem_11rem_5rem]"
            >
              {#if event.status === 'OPEN'}
                <span
                  class="size-2 rounded-full bg-firefly-500 shadow-[0_0_10px_2px] shadow-firefly-500/40"
                  title="Open"
                ></span>
              {:else}
                <span class="size-2 rounded-full ring-1 ring-mist-500/60" title="Finished"></span>
              {/if}

              <span class="truncate font-medium">{event.name}</span>

              <span class="hidden text-mist-500 text-xs sm:block" data-numeric>{event.type}</span>

              <span class="col-start-2 text-mist-500 text-xs sm:col-start-4" data-numeric>
                {formatCoordinates(event.latitude, event.longitude)}
              </span>

              <span class="hidden text-mist-500 text-xs sm:block" data-numeric>
                {formatTimestamp(event.createdAt)}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <aside class="lg:border-night-700 lg:border-l lg:pl-8">
    <h2 class="eyebrow">Open an event</h2>

    <form method="POST" use:enhance class="mt-4 flex flex-col gap-4">
      <label class="flex flex-col gap-1.5">
        <span class="text-mist-400 text-sm">Name</span>
        <input
          name="name"
          value={form?.name ?? ''}
          required
          placeholder="Firefly Night"
          class="border border-night-700 bg-night-900 px-3 py-2 placeholder:text-mist-500/60"
        />
      </label>

      <fieldset class="flex flex-col gap-1.5">
        <legend class="mb-1.5 text-mist-400 text-sm">Devices light up with</legend>
        <div class="grid grid-cols-2 gap-2">
          {#each [['TORCH', 'the flashlight'], ['SCREEN', 'the display']] as [value, description] (value)}
            <label
              class="flex cursor-pointer flex-col gap-0.5 border border-night-700 px-3 py-2 transition-colors has-checked:border-mist-400 has-checked:bg-night-800"
            >
              <input
                type="radio"
                name="type"
                {value}
                checked={(form?.type ?? 'TORCH') === value}
                class="sr-only"
              />
              <span class="text-sm" data-numeric>{value}</span>
              <span class="text-mist-500 text-xs">{description}</span>
            </label>
          {/each}
        </div>
      </fieldset>

      <div class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-1.5">
          <span class="text-mist-400 text-sm">Latitude</span>
          <input
            name="latitude"
            bind:value={latitude}
            required
            inputmode="decimal"
            placeholder="-29.68420"
            class="border border-night-700 bg-night-900 px-3 py-2 placeholder:text-mist-500/60"
            data-numeric
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-mist-400 text-sm">Longitude</span>
          <input
            name="longitude"
            bind:value={longitude}
            required
            inputmode="decimal"
            placeholder="-53.80690"
            class="border border-night-700 bg-night-900 px-3 py-2 placeholder:text-mist-500/60"
            data-numeric
          />
        </label>
      </div>

      <button
        type="button"
        onclick={useMyLocation}
        disabled={locating}
        class="self-start text-mist-500 text-xs underline underline-offset-4 transition-colors hover:text-mist-100 disabled:opacity-50"
      >
        {locating ? 'Reading your location…' : 'Use my location'}
      </button>

      <p class="text-mist-500 text-xs">
        These are the coordinates the event radiates from, not where you stand.
      </p>

      {#if locationError}
        <p class="text-alarm-500 text-sm" role="alert">{locationError}</p>
      {/if}

      {#if form?.error}
        <p class="text-alarm-500 text-sm" role="alert">{form.error}</p>
      {/if}

      <button
        type="submit"
        class="bg-mist-100 px-4 py-2.5 font-medium text-night-950 transition-colors hover:bg-white"
      >
        Open event
      </button>
    </form>
  </aside>
</div>
