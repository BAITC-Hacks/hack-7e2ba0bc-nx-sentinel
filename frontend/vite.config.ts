import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000', '/health': 'http://127.0.0.1:8000' },
    fs: { strict: true, allow: [fileURLToPath(new URL('.', import.meta.url))] },
  },
});
