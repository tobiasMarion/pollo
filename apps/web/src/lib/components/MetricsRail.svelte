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

<aside class="metrics-rail" aria-label="Live field diagnostics">
  <header class="metrics-heading">
    <p class="eyebrow">Live diagnostics</p>
    <p class="metrics-caption">Current field only</p>
  </header>

  <section class="metrics-summary" aria-label="Field summary">
    <div><span data-numeric>{metrics.placedCount}/{metrics.deviceCount}</span><small>placed</small></div>
    <div><span data-numeric>{metrics.edgeCount}</span><small>ranges</small></div>
    <div><span data-numeric>{metrics.largestComponent}</span><small>largest mesh</small></div>
    <div><span data-numeric>{metrics.isolatedCount}</span><small>isolated</small></div>
  </section>

  <section class="metric-section">
    <div class="metric-title">
      <h2>Node degree</h2>
      <span data-numeric>avg {metrics.degrees.mean?.toFixed(1) ?? '—'}</span>
    </div>
    <p>Active links incident to each device.</p>
    <div class="histogram" aria-label="Node degree distribution">
      {#each metrics.degrees.bins as bin (bin.label)}
        <div class="histogram-column" title={`${bin.label}: ${bin.count} devices`}>
          <i style={`height: ${(bin.count / peak(metrics.degrees)) * 100}%`}></i>
          <b data-numeric>{bin.label}</b>
        </div>
      {/each}
    </div>
  </section>

  <section class="metric-section">
    <div class="metric-title"><h2>Worker correction</h2><span data-numeric>p95 {formatMeters(metrics.corrections.p95)}</span></div>
    <p>GPS-to-calculated displacement.</p>
    {#if metrics.corrections.bins.length > 0}
      <div class="histogram" aria-label="Worker correction distribution">
        {#each metrics.corrections.bins as bin (bin.label)}
          <div class="histogram-column" title={`${bin.label}: ${bin.count} devices`}>
            <i style={`height: ${(bin.count / peak(metrics.corrections)) * 100}%`}></i>
            <b data-numeric>{bin.label.replace(' m', '')}</b>
          </div>
        {/each}
      </div>
    {:else}
      <p class="metric-empty">Awaiting a worker placement.</p>
    {/if}
  </section>

  <section class="metric-section">
    <div class="metric-title"><h2>Range lengths</h2><span data-numeric>p95 {formatMeters(metrics.ranges.p95)}</span></div>
    <p>Distances currently constraining the field.</p>
    {#if metrics.ranges.bins.length > 0}
      <div class="histogram" aria-label="Range length distribution">
        {#each metrics.ranges.bins as bin (bin.label)}
          <div class="histogram-column" title={`${bin.label}: ${bin.count} ranges`}>
            <i style={`height: ${(bin.count / peak(metrics.ranges)) * 100}%`}></i>
            <b data-numeric>{bin.label.replace(' m', '')}</b>
          </div>
        {/each}
      </div>
    {:else}
      <p class="metric-empty">No active ranges.</p>
    {/if}
  </section>

  <section class="metric-section">
    <div class="metric-title"><h2>GPS accuracy</h2><span data-numeric>p95 {formatMeters(metrics.gpsAccuracy.p95)}</span></div>
    <p>Reported horizontal uncertainty.</p>
    {#if metrics.gpsAccuracy.bins.length > 0}
      <div class="histogram" aria-label="GPS accuracy distribution">
        {#each metrics.gpsAccuracy.bins as bin (bin.label)}
          <div class="histogram-column" title={`${bin.label}: ${bin.count} devices`}>
            <i style={`height: ${(bin.count / peak(metrics.gpsAccuracy)) * 100}%`}></i>
            <b data-numeric>{bin.label.replace(' m', '')}</b>
          </div>
        {/each}
      </div>
    {:else}
      <p class="metric-empty">No GPS reports.</p>
    {/if}
  </section>
</aside>

<style>
  .metrics-rail { width: 19rem; max-height: calc(100vh - 9.5rem); overflow-y: auto; border-left: 1px solid var(--color-dusk-800); background: color-mix(in srgb, var(--color-dusk-950) 90%, transparent); padding: 1rem; backdrop-filter: blur(14px); }
  .metrics-heading { display: flex; align-items: baseline; justify-content: space-between; gap: .75rem; }
  .metrics-caption, .metric-section p, .metric-empty { margin: .2rem 0 0; color: var(--color-dusk-500); font-size: .6875rem; line-height: 1.35; text-wrap: pretty; }
  .metrics-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: .4rem; margin: 1rem 0; }
  .metrics-summary div { border-radius: .375rem; background: var(--color-dusk-900); padding: .5rem .55rem; box-shadow: 0 0 0 1px rgba(255,255,255,.06), 0 1px 2px rgba(0,0,0,.2); }
  .metrics-summary span, .metrics-summary small { display: block; }
  .metrics-summary span { color: var(--color-dusk-100); font-size: .85rem; }
  .metrics-summary small { margin-top: .1rem; color: var(--color-dusk-500); font-size: .625rem; }
  .metric-section { border-top: 1px solid var(--color-dusk-800); padding: .85rem 0; }
  .metric-title { display: flex; justify-content: space-between; gap: .5rem; color: var(--color-dusk-400); font-size: .6875rem; }
  .metric-title h2 { margin: 0; color: var(--color-dusk-200); font-size: .75rem; font-weight: 500; text-wrap: balance; }
  .histogram { display: flex; height: 4rem; align-items: end; gap: .3rem; margin-top: .65rem; }
  .histogram-column { display: flex; min-width: 0; flex: 1; height: 100%; flex-direction: column; justify-content: end; gap: .25rem; }
  .histogram-column i { display: block; min-height: 2px; border-radius: 2px 2px 0 0; background: var(--color-dusk-400); opacity: .78; }
  .histogram-column b { overflow: hidden; color: var(--color-dusk-500); font-size: .5rem; font-weight: 400; line-height: 1; text-align: center; text-overflow: clip; white-space: nowrap; }
  @media (max-width: 900px) { .metrics-rail { width: 17rem; } }
  @media (max-width: 700px) { .metrics-rail { width: 100%; max-height: none; border-top: 1px solid var(--color-dusk-800); border-left: 0; } }
</style>
