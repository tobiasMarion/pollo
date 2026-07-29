import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  // One .env for the whole monorepo — the backend reads the same file through
  // `node --env-file=../../.env`. This covers `import.meta.env` and the dev
  // server restart; `$env/*` needs `kit.env.dir` in svelte.config.js too.
  envDir: '../../',
  server: {
    // The GitHub OAuth app redirects here; the port is part of that contract.
    port: 3000,
    strictPort: true,
  },
});
