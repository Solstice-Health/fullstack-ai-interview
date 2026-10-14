import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { aiConfigFrom, aiProxy } from './server/aiProxy.ts';

export default defineConfig(({ mode }) => {
  // OPENROUTER_* from the shell or the repo-root .env. Read here in Node only:
  // nothing without the VITE_ prefix reaches the browser.
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const env = loadEnv(mode, repoRoot, 'OPENROUTER_');
  return {
    root: 'web',
    plugins: [react(), aiProxy(aiConfigFrom(env))],
    server: {
      host: process.env.HOST || 'localhost',
      port: 5173,
      strictPort: true,
      fs: { allow: ['..'] },
    },
  };
});
