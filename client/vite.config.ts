import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development, Vite proxies API and WebSocket traffic to the backend,
// so the browser only ever talks to one origin (same as production behind Nginx).
export default defineConfig({
  plugins: [react()],
  build: {
    // CodeMirror + 9 language grammars. Lazy-loaded, so only the editor page pays for it.
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/sandbox': 'http://localhost:4000',
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
});
