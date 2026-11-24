import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { PanelConnection } from '../src/panel/transport.ts';

class Socket {
  readyState = 0;
  sent = [];
  open() { this.readyState = 1; this.onopen(); }
  send(text) { this.sent.push(JSON.parse(text)); }
  message(body) { this.onmessage({ data: JSON.stringify({ jsonrpc: '2.0', ...body }) }); }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
  event(...subscriptionIds) {
    this.message({ method: 'event', params: { from: 'app', event: 'changed', data: 1, subscriptionIds } });
  }
}

function setup(t, checkSession = async () => true) {
  const sockets = [];
  let expired = 0;
  const client = new PanelConnection(() => {
    const socket = new Socket();
    sockets.push(socket);
    return socket;
  }, checkSession, () => { expired++; }, 0);
  t.after(() => client.stop());
  return { client, sockets, get expired() { return expired; } };
}

for (const open of [true, false]) {
  test('add and call preserve invocation order when socket is ' + (open ? 'open' : 'connecting'), async t => {
    const { client, sockets: [socket] } = setup(t);
    if (open) socket.open();
    const seen = [];
    client.subscribe({ events: 'changed' }, event => seen.push(event.data), () => seen.push('ready'));
    const result = client.rpc('call', { node: 'app' });
    if (!open) { assert.equal(socket.sent.length, 0); socket.open(); }
    assert.deepEqual(socket.sent.map(r => r.method), ['subscriptions.add', 'call']);
    const [add, call] = socket.sent;
    socket.event(add.params.subscriptions[0].id);
    socket.message({ id: add.id, result: {} });
    socket.message({ id: call.id, result: 5 });
    assert.equal(await result, 5);
    assert.deepEqual(seen, [1, 'ready']);
  });
}

test('overlapping matches, replaced listeners and denied registration', async t => {
  const { client, sockets: [socket] } = setup(t);
  socket.open();
  const seen = [];
  const remove = client.subscribe({}, () => seen.push('first'));
  client.subscribe({}, () => seen.push('second'));
  const [a, b] = socket.sent.map(r => r.params.subscriptions[0].id);
  socket.event(a, b, a);
  remove();
  assert.deepEqual(socket.sent[2].params, { ids: [a] });
  client.subscribe({}, () => seen.push('third'), undefined, error => seen.push(error.message));
  const [replacement] = socket.sent[3].params.subscriptions;
  assert.notEqual(replacement.id, a);
  socket.message({ id: socket.sent[3].id, error: { code: -1, message: 'denied' } });
  await Promise.resolve();
  socket.event(a, b, replacement.id);
  assert.deepEqual(seen, ['first', 'second', 'denied', 'second']);
});

test('reconnect restores mounted filters and rejects interrupted calls without replay', async t => {
  const { client, sockets } = setup(t);
  const old = sockets[0];
  old.open();
  const seen = [];
  client.subscribe({ events: 'a' }, e => seen.push(e.event), () => seen.push('ready'));
  const remove = client.subscribe({ events: 'b' }, () => seen.push('b'));
  const call = client.rpc('call', {});
  old.close(1006);
  remove();
  await assert.rejects(call);
  await delay(10);
  const next = sockets[1];
  next.open();
  assert.deepEqual(next.sent.map(r => r.method), ['subscriptions.add']);
  const add = next.sent[0];
  assert.equal(add.params.subscriptions[0].events, 'a');
  old.event(add.params.subscriptions[0].id);
  old.message({ id: add.id, result: {} });
  old.close(4401);
  assert.deepEqual(seen, []);
  next.message({ id: add.id, result: {} });
  await Promise.resolve();
  next.event(add.params.subscriptions[0].id);
  assert.deepEqual(seen, ['ready', 'changed']);
});

test('disposing a listener while connecting leaves no subscription on the socket', t => {
  const { client, sockets: [socket] } = setup(t);
  client.subscribe({}, () => assert.fail())();
  socket.open();
  assert.deepEqual(socket.sent, []);
});

for (const code of [4401, 1006]) {
  test('revoked session stops reconnects on close ' + code, async t => {
    const ctx = setup(t, async () => false);
    const call = ctx.client.rpc('call', {});
    ctx.sockets[0].close(code);
    await assert.rejects(call);
    await delay(10);
    assert.equal(ctx.expired, 1);
    assert.equal(ctx.sockets.length, 1);
    await assert.rejects(ctx.client.rpc('call', {}));
  });
}
