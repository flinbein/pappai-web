import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snapshotReader } from '../src/panel/refresh-snapshot.ts';

test('notifications arriving during a snapshot share one trailing read', async () => {
  const reads = [];
  const applied = [];
  const refresh = snapshotReader(() => {
    const read = Promise.withResolvers();
    reads.push(read);
    return read.promise;
  }, value => applied.push(value));
  const done = refresh();
  await Promise.resolve();
  assert.equal(refresh(), done);
  assert.equal(refresh(), done);
  reads[0].resolve('old');
  await Promise.resolve();
  assert.deepEqual(applied, []);
  assert.equal(reads.length, 2);
  reads[1].resolve('latest');
  await done;
  assert.deepEqual(applied, ['latest']);
});

test('a failed snapshot can be retried', async () => {
  const applied = [];
  let reads = 0;
  const refresh = snapshotReader(async () => {
    if (++reads === 1) throw Error('disconnected');
    return reads;
  }, value => applied.push(value));
  await assert.rejects(refresh(), /disconnected/);
  await refresh();
  assert.deepEqual(applied, [2]);
});
