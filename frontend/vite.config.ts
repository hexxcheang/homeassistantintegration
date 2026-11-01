import { defineConfig } from 'vitest/config';

// One ES module, written straight into the integration so Home Assistant serves it.
export default defineConfig({
  build: {
    outDir: '../custom_components/maxsen/frontend',
    emptyOutDir: true,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'maxsen-home.js',
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
  },
});
