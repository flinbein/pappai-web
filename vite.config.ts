import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/_web/${pkg.version}/` : '/',
  plugins: [react(), {
    name: 'headless-xterm-worker-global',
    // xterm 6 probes window for requestIdleCallback even in its headless build.
    transform(code, id) {
      if ((id.includes('/@xterm/headless/') || id.includes('/deps/@xterm_headless.js')) && code.includes('in window')) {
        return code.replaceAll('in window','in globalThis');
      }
    },
  }],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api/': { target: 'http://127.0.0.1:3000', changeOrigin: false, ws: true },
      '^/files(?:/|$)': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
  build: {
    license: true,
    target: 'chrome140',
    rolldownOptions: {
      input: {main:'index.html', terminal:'terminal.html', 'shared-worker':'src/panel/shared-worker.ts'},
      output: { entryFileNames: entry => entry.name === 'shared-worker' ? 'assets/shared-worker.js' : 'assets/[name]-[hash].js' },
    },
  },
}));
