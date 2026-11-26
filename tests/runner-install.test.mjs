import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installerResult, nameFromEntrypoint, prepareCommand, suggestedName } from '../src/panel/runner-install.ts';

const dir = '/run/pappai/private/runners/codex/';
const entrypoint = dir + 'releases/v1/über.mjs';
const marker = 'PAPPAI_RESULT ' + JSON.stringify({entrypoint});
function output(text) {
  const parser = installerResult();
  for (const byte of new TextEncoder().encode(text)) parser.write(Uint8Array.of(byte));
  return parser;
}

test('installation names from versioned packages, repositories and custom paths', () => {
  for (const spec of ['@flinbein/pappai-runner-codex@latest', 'pappai-runner-codex@1.0']) {
    assert.equal(suggestedName('npm', spec), 'codex');
  }
  assert.equal(suggestedName('git', 'https://example.org/owner/pappai-runner-codex.git'), 'codex');
  assert.equal(nameFromEntrypoint(entrypoint), 'codex');
  for (const path of ['/tmp/codex', dir, dir + '../../x', dir + '/x', dir + './x']) {
    assert.throws(() => nameFromEntrypoint(path));
  }
});

test('terminal command keeps each installer argument in a separate quoted word', () => {
  assert.equal(prepareCommand('update', 'git', 'codex', "https://host/it's a repo", 'release candidate'),
    "node /opt/pappai/scripts/prepare-runner.mjs 'update' 'git' 'codex' 'https://host/it'\\''s a repo' 'release candidate'");
  assert.throws(() => prepareCommand('add', 'npm', 'codex', 'a\nb', ''));
});

test('only the final logical result after a successful exit can register a runner', () => {
  assert.equal(output('x'.repeat(20000) + '\r\nprogress\r\n' + marker + '\r\n').finish({exitCode:0}, 'codex'), entrypoint);
  assert.equal(output(marker).finish({exitCode:0}, 'codex'), entrypoint);
  for (const text of [marker + '\r\nmore', 'prefix ' + marker, marker + '\n' + 'x'.repeat(18000),
    'PAPPAI_RESULT {', 'PAPPAI_RESULT {"entrypoint":"/tmp/x"}', 'PAPPAI_RESULT {}']) {
    assert.throws(() => output(text).finish({exitCode:0}, 'codex'));
  }
  for (const end of [{exitCode:1}, {disconnected:true}, {error:'startup failure'}]) {
    assert.throws(() => output(marker).finish(end, 'codex'));
  }
  assert.throws(() => output(marker).finish({exitCode:0}, 'another'));
});
