import { defineConfig } from 'vite';

// Explicitly isolate the bundled desktop frontend from the production TanStack app.
export default defineConfig({
  root: __dirname,
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
