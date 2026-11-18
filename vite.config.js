import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for the PocketDB renderer (React studio UI).
// `base: './'` is required so Electron can load the built bundle
// from disk via the file:// protocol without broken absolute paths.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
