import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/_web/${pkg.version}/` : '/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '^/(auth/|session$|rpc$|files(?:/|$))': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/ws/': { target: 'ws://127.0.0.1:3000', changeOrigin: false, ws: true },
    },
  },
  build: {
    license: true,
    target: 'chrome140',
    rolldownOptions: { input: ['index.html', 'terminal.html'] },
  },
}));
