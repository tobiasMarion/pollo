<script lang="ts">
import type { Edge } from '@pollo/contracts'
import type { DeviceState } from '$lib/field-state.svelte'
import { type Distribution, fieldMetrics, formatMeters } from '$lib/metrics'

let { devices, edges }: { devices: DeviceState[]; edges: Edge[] } = $props()

const metrics = $derived(fieldMetrics(devices, edges))

function peak(distribution: Distribution) {
  return Math.max(1, ...distribution.bins.map(bin => bin.count))
}
</script>

<aside
  class="metrics-rail-height w-76 overflow-y-auto border-dusk-800 border-l bg-dusk-950/90 p-4 backdrop-blur-sm max-rail:w-68 max-handset:max-h-none max-handset:w-full max-handset:border-t max-handset:border-l-0"
  aria-label="Live field diagnostics"
>
  <header class="flex items-baseline justify-between gap-3">
    <p class="eyebrow">Live diagnostics</p>
    <p class="m-0 mt-0.5 text-pretty text-xs leading-snug text-dusk-500">
      Current field only
    </p>
  </header>

  <section class="my-4 grid grid-cols-2 gap-1.5" aria-label="Field summary">
    <div class="rounded-md bg-dusk-900 px-2 py-2 shadow-metric">
      <span class="block text-sm text-dusk-100" data-numeric>{metrics.placedCount}/{metrics.deviceCount}</span>
      <small class="mt-px block text-2xs text-dusk-500">placed</small>
    </div>
    <div class="rounded-md bg-dusk-900 px-2 py-2 shadow-metric">
      <span class="block text-sm text-dusk-100" data-numeric>{metrics.edgeCount}</span>
      <small class="mt-px block text-2xs text-dusk-500">ranges</small>
    </div>
    <div class="rounded-md bg-dusk-900 px-2 py-2 shadow-metric">
      <span class="block text-sm text-dusk-100" data-numeric>{metrics.largestComponent}</span>
      <small class="mt-px block text-2xs text-dusk-500">largest mesh</small>
    </div>
    <div class="rounded-md bg-dusk-900 px-2 py-2 shadow-metric">
      <span class="block text-sm text-dusk-100" data-numeric>{metrics.isolatedCount}</span>
      <small class="mt-px block text-2xs text-dusk-500">isolated</small>
    </div>
  </section>

  <section class="border-dusk-800 border-t py-3.5">
    <div class="flex justify-between gap-2 text-xs text-dusk-400">
      <h2 class="m-0 text-balance text-xs font-medium text-dusk-200">Node degree</h2>
      <span data-numeric>avg {metrics.degrees.mean?.toFixed(1) ?? '—'}</span>
    </div>
    <p class="m-0 mt-0.5 text-pretty text-xs leading-snug text-dusk-500">
      Active links incident to each device.
    </p>
    <div class="mt-2.5 flex h-16 items-end gap-1" aria-label="Node degree distribution">
      {#each metrics.degrees.bins as bin (bin.label)}
        <div class="flex h-full min-w-0 flex-1 flex-col justify-end gap-1" title={`${bin.label}: ${bin.count} devices`}>
          <i class="block min-h-0.5 rounded-t-sm bg-dusk-400 opacity-80" style:height={`${(bin.count / peak(metrics.degrees)) * 100}%`}></i>
          <b class="overflow-hidden text-center text-3xs leading-none font-normal text-dusk-500 text-clip whitespace-nowrap" data-numeric>{bin.label}</b>
        </div>
      {/each}
    </div>
  </section>

  <section class="border-dusk-800 border-t py-3.5">
    <div class="flex justify-between gap-2 text-xs text-dusk-400"><h2 class="m-0 text-balance text-xs font-medium text-dusk-200">Worker correction</h2><span data-numeric>p95 {formatMeters(metrics.corrections.p95)}</span></div>
    <p class="m-0 mt-0.5 text-pretty text-xs leading-snug text-dusk-500">GPS-to-calculated displacement.</p>
    {#if metrics.corrections.bins.length > 0}
      <div class="mt-2.5 flex h-16 items-end gap-1" aria-label="Worker correction distribution">
        {#each metrics.corrections.bins as bin (bin.label)}
          <div class="flex h-full min-w-0 flex-1 flex-col justify-end gap-1" title={`${bin.label}: ${bin.count} devices`}>
            <i class="block min-h-0.5 rounded-t-sm bg-dusk-400 opacity-80" style:height={`${(bin.count / peak(metrics.corrections)) * 100}%`}></i>
            <b class="overflow-hidden text-center text-3xs leading-none font-normal text-dusk-500 text-clip whitespace-nowrap" data-numeric>{bin.label.replace(' m', '')}</b>
          </div>
        {/each}
      </div>
    {:else}
      <p class="m-0 mt-0.5 text-pretty text-xs leading-snug text-dusk-500">Awaiting a worker placement.</p>
    {/if}
  </section>

  <section class="border-dusk-800 border-t py-3.5">
    <div class="flex justify-between gap-2 text-xs text-dusk-400"><h2 class="m-0 text-balance text-xs font-medium text-dusk-200">Range lengths</h2><span data-numeric>p95 {formatMeters(metrics.ranges.p95)}</span></div>
    <p class="m-0 mt-0.5 text-pretty text-xs leading-snug text-dusk-500">Distances currently constraining the field.</p>
    {#if metrics.ranges.bins.length > 0}
      <div class="mt-2.5 flex h-16 items-end gap-1" aria-label="Range length distribution">
        {#each metrics.ranges.bins as bin (bin.label)}
          <div class="flex h-full min-w-0 flex-1 flex-col justify-end gap-1" title={`${bin.label}: ${bin.count} ranges`}>
            <i class="block min-h-0.5 rounded-t-sm bg-dusk-400 opacity-80" style:height={`${(bin.count / peak(metrics.ranges)) * 100}%`}></i>
            <b class="overflow-hidden text-center text-3xs leading-none font-normal text-dusk-500 text-clip whitespace-nowrap" data-numeric>{bin.label.replace(' m', '')}</b>
          </div>
        {/each}
      </div>
    {:else}
      <p class="m-0 mt-0.5 text-pretty text-xs leading-snug text-dusk-500">No active ranges.</p>
    {/if}
  </section>

  <section class="border-dusk-800 border-t py-3.5">
    <div class="flex justify-between gap-2 text-xs text-dusk-400"><h2 class="m-0 text-balance text-xs font-medium text-dusk-200">GPS accuracy</h2><span data-numeric>p95 {formatMeters(metrics.gpsAccuracy.p95)}</span></div>
    <p class="m-0 mt-0.5 text-pretty text-xs leading-snug text-dusk-500">Reported horizontal uncertainty.</p>
    {#if metrics.gpsAccuracy.bins.length > 0}
      <div class="mt-2.5 flex h-16 items-end gap-1" aria-label="GPS accuracy distribution">
        {#each metrics.gpsAccuracy.bins as bin (bin.label)}
          <div class="flex h-full min-w-0 flex-1 flex-col justify-end gap-1" title={`${bin.label}: ${bin.count} devices`}>
            <i class="block min-h-0.5 rounded-t-sm bg-dusk-400 opacity-80" style:height={`${(bin.count / peak(metrics.gpsAccuracy)) * 100}%`}></i>
            <b class="overflow-hidden text-center text-3xs leading-none font-normal text-dusk-500 text-clip whitespace-nowrap" data-numeric>{bin.label.replace(' m', '')}</b>
          </div>
        {/each}
      </div>
    {:else}
      <p class="m-0 mt-0.5 text-pretty text-xs leading-snug text-dusk-500">No GPS reports.</p>
    {/if}
  </section>
</aside>
