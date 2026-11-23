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
      '/auth/': 'http://localhost:3000',
      '/session': 'http://localhost:3000',
      '/rpc': 'http://localhost:3000',
      '/files/': 'http://localhost:3000',
      '/ws/': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    license: true,
    target: 'chrome140',
    rolldownOptions: { input: ['index.html', 'terminal.html'] },
  },
}));
