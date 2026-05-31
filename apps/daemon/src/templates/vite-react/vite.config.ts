import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vision Design proxies this dev server through the daemon so the canvas
// can inject the edit bridge. Leave the port unfixed — the daemon reads
// the value Vite chooses from stdout and stores it.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    strictPort: false,
  },
});
