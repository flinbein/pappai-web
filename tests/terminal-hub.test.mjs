import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import headless from '@xterm/headless';
import {TerminalHub} from '../src/terminal/hub.ts';
import {useWorkerDeviceReplies} from '../src/terminal/protocol.ts';

const encode = text => new TextEncoder().encode(text);
const decode = data => new TextDecoder().decode(data);
async function until(read) {
  const end = Date.now() + 2000;
  while (Date.now() < end) {
    const result = read();
    if (result) return result;
    await delay(3);
  }
  assert.fail('Timed out waiting for the terminal');
}

class Socket {
  readyState = 0;
  controls = [];
  inputs = [];
  send(data) {
    if (typeof data === 'string') this.controls.push(JSON.parse(data));
    else this.inputs.push(new Uint8Array(data));
  }
  start() {
    this.readyState = 1;
    this.onopen();
    this.onmessage({data:JSON.stringify({started:true, program:'/bin/sh', sandboxed:true})});
  }
  output(bytes) {
    this.onmessage({data:typeof bytes === 'string' ? encode(bytes).buffer : bytes.buffer});
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
function setup(t) {
  const sockets = [];
  const hub = new TerminalHub('current-session', (session, sandbox) => {
    assert.equal(session, 'current-session');
    assert.equal(sandbox, true);
    const socket = new Socket();
    sockets.push(socket);
    return socket;
  });
  t.after(() => hub.dispose());
  function page(autoAck = true) {
    const messages = [];
    const port = {postMessage(message) {
      messages.push(structuredClone(message));
      if (message.type === 'terminal.registry')
        queueMicrotask(() => send('registryAck', {seq:message.seq}));
      else if (autoAck && 'seq' in message)
        queueMicrotask(() => send('ack', {id:message.id, seq:message.seq}));
    }};
    function send(type, fields = {}) { hub.receive(port, {type:'terminal.' + type, id:1, ...fields}); }
    const frames = type => messages.filter(message => message.type === 'terminal.' + type);
    hub.attach(port);
    return {port, send, frames, messages};
  }
  const owner = page();
  function launch(command = {argv:['/bin/sh', 'secret'], env:{TOKEN:'private'}}) {
    owner.send('launch', {requestId:'launch', command, theme:'Pappai', sandbox:true, cols:90, rows:22});
    return sockets.at(-1);
  }
  return {hub, owner, page, sockets, launch};
}

test('registry identity is shared across pages and changes when a new hub reuses terminal IDs', async t => {
  const first = setup(t), second = setup(t);
  first.launch();
  second.launch();
  const registry = async page => until(() => page.frames('registry').find(message => message.entries.length));
  const [original, otherPage, replacement] = await Promise.all([
    registry(first.owner), registry(first.page()), registry(second.owner),
  ]);
  assert.equal(original.entries[0].id, replacement.entries[0].id);
  assert.ok(original.worker);
  assert.equal(original.worker, otherPage.worker);
  assert.notEqual(original.worker, replacement.worker);
});

test('one PTY per launch, private launch fields, port and epoch fenced handoff and drag release', async t => {
  const {hub, owner, page, sockets, launch} = setup(t);
  const mirror = page();
  const socket = launch();
  socket.start();
  assert.deepEqual(socket.controls[0], {argv:['/bin/sh','secret'], env:{TOKEN:'private'}, cols:90, rows:22});
  owner.send('watch');
  mirror.send('watch');
  const first = await until(() => owner.frames('snapshot')[0]);
  await until(() => mirror.frames('snapshot')[0]);
  assert.equal(mirror.frames('created').length, 0);
  assert.equal(owner.frames('created')[0].requestId, 'launch');
  assert.doesNotMatch(JSON.stringify(mirror.messages), /secret|TOKEN|private/);
  const oldEpoch = first.epoch, epoch = oldEpoch + 1;
  socket.output('\x1b[?1002h\x1b[?1006h\x1b[?25l\x1b]0;Editor\x07\x1b[6n');
  await until(() => mirror.frames('output')[0]);
  assert.deepEqual(socket.inputs.map(decode), ['\x1b[1;1R']);
  mirror.send('input', {epoch:oldEpoch, data:encode('forbidden')});
  owner.send('input', {epoch:oldEpoch, data:encode('\x1b[<0;4;8M')});
  owner.send('input', {epoch:oldEpoch, data:encode('\x1b[<32;7;9M')});
  mirror.send('take', {cols:60, rows:12});
  owner.send('size', {epoch:oldEpoch, cols:501, rows:401});
  owner.send('input', {epoch:oldEpoch, data:encode('stale')});
  const snapshot = await until(() => mirror.frames('snapshot').find(m => m.epoch === epoch));
  assert.match(snapshot.data, /\x1b\[\?1006h/);
  assert.match(snapshot.data, /\x1b\[\?25l/);
  assert.equal(snapshot.owner, true);
  mirror.send('input', {epoch, data:encode('new')});
  assert.deepEqual(socket.inputs.map(decode), ['\x1b[1;1R','\x1b[<0;4;8M','\x1b[<32;7;9M','\x1b[<0;7;9m','new']);
  await until(() => socket.controls.some(c => c.cols === 60));
  assert.equal(socket.controls.some(c => c.cols === 501), false);
  assert.equal(sockets.length, 1);
  assert.equal(mirror.frames('registry').at(-1).entries[0].title, 'Editor');
  hub.detach(mirror.port);
  assert.equal(socket.readyState, 1);
  socket.close();
  await until(() => owner.frames('registry').at(-1).entries[0].detail === 'disconnected');
  owner.send('take', {cols:80, rows:24});
  assert.equal(sockets.length, 1);
  owner.send('remove', {ids:[1]});
  await until(() => owner.frames('registry').at(-1).entries.length === 0);
});

test('registry preserves CLI grouping, failure details and independent terminal lifetimes', async t => {
  const {launch, owner, page, sockets} = setup(t);
  const mirror = page();
  const cli = {node:'editor', method:'open', input:{args:['confidential'], env:{TOKEN:'private'}}};
  const first = launch({cli}), second = launch();
  first.readyState = 1;
  first.onopen();
  first.onmessage({data:JSON.stringify({startFailed:true, error:'Executable unavailable'})});
  first.close();
  second.start();
  second.output('done');
  second.onmessage({data:JSON.stringify({exitCode:2})});
  second.close();
  await until(() => mirror.frames('registry').at(-1).entries[1]?.state === 'nonzero');
  const entries = mirror.frames('registry').at(-1).entries;
  assert.deepEqual(entries.map(e => [e.id, e.state, e.detail]), [
    [1,'failed','Executable unavailable'], [2,'nonzero','exit code 2'],
  ]);
  assert.deepEqual(entries[0].cli, {node:'editor', method:'open'});
  assert.doesNotMatch(JSON.stringify(entries), /confidential|private|TOKEN/);
  mirror.send('watch', {id:2});
  await until(() => mirror.frames('snapshot').some(m => m.data.includes('done')));
  mirror.send('theme', {id:2, theme:'Tomorrow'});
  owner.send('remove', {ids:[1]});
  await until(() => mirror.frames('registry').at(-1).entries.length === 1);
  assert.equal(mirror.frames('registry').at(-1).entries[0].theme, 'Tomorrow');
  assert.equal(sockets.length, 2);
});

test('headless parser ACKs each transport frame once while a frozen viewer catches up from bounded state', async t => {
  const {launch, page} = setup(t);
  const socket = launch();
  socket.start();
  const frozen = page(false);
  frozen.send('watch');
  await until(() => frozen.frames('snapshot').length);
  for (let i = 0; i < 100; i++) socket.output('line ' + i + '\r\n');
  await until(() => socket.controls.filter(c => 'rendered' in c).length === 100);
  assert.ok(frozen.frames('output').length <= 32);
  assert.equal(socket.controls.filter(c => 'rendered' in c).reduce((size, c) => size + c.rendered, 0), 890);
  for (const m of [...frozen.frames('snapshot'), ...frozen.frames('output')]) frozen.send('ack', {seq:m.seq});
  const recovery = await until(() => frozen.frames('snapshot')[1]);
  assert.match(recovery.data, /line 99/);
  socket.output('line 100');
  await until(() => frozen.frames('output').some(m => decode(m.data) === 'line 100'));
});

test('watching between fragments of UTF-8 and VT sequences preserves the completed screen', async t => {
  const {launch, page} = setup(t);
  const socket = launch();
  socket.start();
  const mirror = page();
  for (const [first, last, expected] of [
    [Uint8Array.of(0xf0,0x9f), Uint8Array.of(0x98,0x80), '😀'],
    ['\x1b[', '32mgreen', 'green'],
  ]) {
    const count = mirror.frames('snapshot').length;
    socket.output(first);
    mirror.send('watch');
    await until(() => mirror.frames('snapshot').length > count);
    socket.output(last);
    const snapshot = await until(() => mirror.frames('snapshot')[count + 1]);
    assert.ok(snapshot.data.includes(expected));
    mirror.send('unwatch');
  }
});

test('display parser consumes canonical device queries while typed data is preserved', async () => {
  const model = new headless.Terminal({allowProposedApi:true});
  try {
    useWorkerDeviceReplies(model);
    const replies = [];
    model.onData(data => replies.push(data));
    await new Promise(done => model.write('\x1b[5n\x1b[6n\x1b[?6n\x1b[c\x1b[>c\x1b[?25$p\x1bP$qm\x1b\\', done));
    model.input('A', true);
    assert.deepEqual(replies, ['A']);
  } finally { model.dispose(); }
});

test('alternate buffer with origin-relative scroll margins continues scrolling after a snapshot', async t => {
  const {launch, page} = setup(t);
  const socket = launch();
  socket.start();
  socket.output('\x1b[?1049h\x1b[2;4r\x1b[?6h\x1b[3;1Hbottom');
  const viewer = page();
  viewer.send('watch');
  const snapshot = await until(() => viewer.frames('snapshot')[0]);
  const term = new headless.Terminal({allowProposedApi:true, cols:snapshot.cols, rows:snapshot.rows});
  t.after(() => term.dispose());
  const write = data => new Promise(done => term.write(data, done));
  await write(snapshot.data);
  await write('\r\nnext');
  assert.equal(term.buffer.active.type, 'alternate');
  assert.equal(term.buffer.active.getLine(2).translateToString(true), 'bottom');
  assert.equal(term.buffer.active.getLine(3).translateToString(true), 'next');
});
