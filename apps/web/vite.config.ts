import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react()],
  server: {
    allowedHosts: process.env.DEV_ALLOWED_HOST ? [process.env.DEV_ALLOWED_HOST] : [],
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://127.0.0.1:8000',
    },
  },
});
