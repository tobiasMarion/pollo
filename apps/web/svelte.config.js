import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    env: {
      // `$env/*` resolves through this, not through Vite's `envDir`, so the
      // monorepo .env has to be pointed at twice — see vite.config.ts.
      dir: fileURLToPath(new URL('../../', import.meta.url)),
    },
  },
};
