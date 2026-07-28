import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The UI talks to the local daemon on 127.0.0.1 and to nothing else. The proxy below is what
// keeps that true in development: the dev server forwards /api to the daemon rather than the
// browser reaching anything across the network.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8790', changeOrigin: false },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
