<script lang="ts">
let { data, children } = $props()
</script>

<div class="flex min-h-svh flex-col">
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

  <main class="flex flex-1 flex-col">
    {@render children()}
  </main>
</div>
