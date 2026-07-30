import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Browser-tab path: talks to the local daemon on 127.0.0.1. The proxy below keeps that true in
// development. Desktop path: the same build loads from disk in Tauri and calls HostSession via
// invoke (host-client.ts). Relative base keeps assets resolvable under both.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8790', changeOrigin: false },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
