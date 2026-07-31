import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  // One .env for the whole monorepo — the backend reads the same file through
  // `node --env-file=../../.env`. This covers `import.meta.env` and the dev
  // server restart; `$env/*` needs `kit.env.dir` in svelte.config.js too.
  envDir: '../../',
  ssr: {
    // The panel's production image ships the adapter-node bundle and nothing
    // else — no node_modules to resolve against — so the contracts have to be
    // compiled in rather than left as an external import.
    noExternal: ['@pollo/contracts'],
  },
  server: {
    // The GitHub OAuth app redirects here; the port is part of that contract.
    port: 3000,
    strictPort: true,
  },
});
