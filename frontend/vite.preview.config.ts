import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The preview app: the real panel on a simulated Home Assistant. It only serves (`npm run preview`);
// the integration's bundle is built by vite.config.ts and is not touched by this file.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: 'preview',
  server: {
    port: 5174,
    strictPort: true,
    // The preview opens tests/fixtures/home-v1.json, which lives above frontend/.
    fs: { allow: [repoRoot] },
  },
});
