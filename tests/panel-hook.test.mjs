import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer } from 'vite';

const chrome = [process.env.PAPPAI_CHROME_BIN,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(path => path && existsSync(path));

for (const [fixture, title] of [
  ['hook', 'React event hook orders registration before effects, updates callbacks and cleans up'],
  ['cli', 'CLI and shell terminals share sessions across routes, validate launch inputs and close groups'],
  ['runner', 'Workspace runner preparation survives navigation and retries registration without reinstalling'],
]) test(title, {
  skip: chrome ? false : 'Set PAPPAI_CHROME_BIN to run this Chromium test',
}, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'pappai-hook-'));
  t.after(() => rm(temp, { recursive: true, force: true, maxRetries: 5 }));
  const finished = Promise.withResolvers();
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)), configFile: false,
    cacheDir: join(temp, 'vite'), logLevel: 'error',
    plugins: [{name: 'fixture-completion', configureServer(server) {
      server.middlewares.use('/test-pending', (_req, res) => {
        void finished.promise.then(() => { res.writeHead(204); res.end(); });
      });
      server.middlewares.use('/test-finished', (_req, res) => {
        finished.resolve(); res.writeHead(204); res.end();
      });
    }}],
    server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  t.after(() => server.close());
  await server.listen();
  const { port } = server.httpServer.address();
  const { stdout } = await promisify(execFile)(chrome, [
    '--headless', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--user-data-dir=' + join(temp, 'chrome'),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '--dump-dom', 'http://127.0.0.1:' + port + '/tests/' + fixture + '.html',
  ], { windowsHide: true, timeout: 45000 });
  assert.equal(stdout.match(/<output>([\s\S]*?)<\/output>/)?.[1], 'pass');
});
