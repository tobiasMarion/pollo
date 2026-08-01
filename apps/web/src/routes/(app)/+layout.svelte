<script lang="ts">
let { data, children } = $props()
</script>

<!--
  `h-svh`, not `min-h-svh`: a minimum lets the column grow past the viewport, and
  everything below inherits that freedom — a pane that wants to scroll on its own
  never gets a height to scroll within, so its content pushes the whole document
  instead. The height has to be settled here for anything downstream to bound.
-->
<div class="flex h-svh flex-col">
  <header
    class="flex items-center justify-between gap-4 border-dusk-800 border-b px-5 py-3 md:px-8"
  >
    <a href="/" class="font-display font-bold text-lg tracking-tight">Pollo</a>

    <div class="flex items-center gap-3">
      {#if data.user.avatarUrl}
        <img
          src={data.user.avatarUrl}
          alt=""
          width="24"
          height="24"
          class="size-6 rounded-full ring-1 ring-dusk-800"
        />
      {/if}
      <span class="hidden text-dusk-400 text-sm sm:inline">{data.user.name ?? data.user.email}</span>
      <form method="POST" action="/logout">
        <button
          type="submit"
          class="text-dusk-500 text-sm transition-colors hover:text-dusk-200"
        >
          Sign out
        </button>
      </form>
    </div>
  </header>

  <!--
    `min-h-0` because a flex item defaults to `min-height: auto` and refuses to
    shrink below its content, which would undo the bounded height above it. The
    scroll lands here so pages that are simply long — the events list — still
    scroll as a whole, while a page that fills the viewport exactly leaves this
    container with nothing to scroll and its own panes take over.
  -->
  <main class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    {@render children()}
  </main>
</div>
