import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    host: process.env.HOST || 'localhost',
    port: 5173,
    proxy: { '/api/': `http://127.0.0.1:${process.env.API_PORT ?? 3000}` },
  },
});
