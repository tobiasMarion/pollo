<script lang="ts">
let { data, children } = $props();
</script>

<div class="flex min-h-svh flex-col">
  <header
    class="flex items-center justify-between gap-4 border-neutral-800 border-b px-5 py-3 md:px-8"
  >
    <a href="/" class="font-display font-bold text-lg tracking-tight">Pollo</a>

    <div class="flex items-center gap-3">
      {#if data.user.avatarUrl}
        <img
          src={data.user.avatarUrl}
          alt=""
          width="24"
          height="24"
          class="size-6 rounded-full ring-1 ring-neutral-800"
        />
      {/if}
      <span class="hidden text-neutral-400 text-sm sm:inline">{data.user.name ?? data.user.email}</span>
      <form method="POST" action="/logout">
        <button
          type="submit"
          class="text-neutral-500 text-sm transition-colors hover:text-neutral-200"
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
