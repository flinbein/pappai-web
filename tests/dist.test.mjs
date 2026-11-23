import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
for (const entry of ['index.html', 'terminal.html']) {
  test(`${entry} loads its JavaScript and styles from this release`, async () => {
    const html = await readFile(new URL('dist/' + entry, root), 'utf8');
    const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(([, url]) => url);
    assert.ok(urls.some(url => url.endsWith('.js')));
    assert.ok(urls.some(url => url.endsWith('.css')));
    const prefix = `/_web/${version}/assets/`;
    for (const url of urls) {
      assert.ok(url.startsWith(prefix), 'Unexpected resource URL: ' + url);
      assert.ok((await stat(new URL('dist/assets/' + url.slice(prefix.length), root))).isFile());
    }
  });
}
