import headless, {type ITerminalAddon, type Terminal} from '@xterm/headless';
import {SerializeAddon} from '@xterm/addon-serialize';
import type {TerminalEntry, TerminalEvent, TerminalRequest, TerminalState} from './protocol';

type Port = {postMessage(message: TerminalEvent): void};
type Launch = Extract<TerminalRequest, {type: 'terminal.launch'}>;
type ScreenFrame = Extract<TerminalEvent, {epoch: number}>;
type Content = {type: 'terminal.output'; data: Uint8Array} | {type: 'terminal.resize'; cols: number; rows: number};
interface Watch {
  ready: boolean;
  epoch: number;
  partial: boolean;
  scheduling: boolean;
  bytes: number;
  pending: Map<number, number>;
}
interface Session {
  entry: Omit<TerminalEntry, 'owner'>;
  owner?: Port;
  socket: WebSocket;
  model: Terminal;
  serializer: SerializeAddon;
  watches: Map<Port, Watch>;
  release?: Uint8Array<ArrayBuffer>;
  startSize?: {cols: number; rows: number};
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const validSize = (n?: number): n is number => n !== undefined && Number.isInteger(n) && n >= 1 && n <= 1000;
const open = (s: Session) => s.socket.readyState === 1;
const live = (s: Session) => s.entry.state === 'connecting' || s.entry.state === 'online';
const maxFrames = 32, maxBytes = 131072;

// xterm 6's serializer omits scroll margins, cursor visibility, mouse encoding
// and partial parser state. These fields belong to the pinned headless build.
function screenState(model: Terminal) {
  const core = (model as unknown as {_core: {
    coreService: {isCursorHidden: boolean};
    coreMouseService: {activeEncoding: string};
    _bufferService: {buffer: {scrollTop: number; scrollBottom: number}};
    _inputHandler: {_parser: {currentState: number; initialState: number}; _utf8Decoder: {interim: Uint8Array}};
  }})._core;
  const {_parser, _utf8Decoder} = core._inputHandler;
  const partial = _parser.currentState !== _parser.initialState || Boolean(_utf8Decoder.interim[0]);
  const encoding = core.coreMouseService.activeEncoding;
  const {scrollTop, scrollBottom} = core._bufferService.buffer;
  let region = '';
  if (scrollTop || scrollBottom !== model.rows - 1 || model.modes.originMode) {
    const {cursorX, cursorY} = model.buffer.active;
    const row = cursorY - (model.modes.originMode ? scrollTop : 0) + 1;
    // DECSTBM homes the cursor. CUP takes a row relative to the margin in DECOM.
    region = '\x1b[' + (scrollTop + 1) + ';' + (scrollBottom + 1) + 'r\x1b[' + row + ';' + (cursorX + 1) + 'H';
  }
  const modes = region + (encoding === 'SGR' ? '\x1b[?1006h' : encoding === 'SGR_PIXELS' ? '\x1b[?1016h' : '') +
    (core.coreService.isCursorHidden ? '\x1b[?25l' : '\x1b[?25h');
  return {partial, modes};
}

function terminalSocket(browserSession: string | undefined, sandbox: boolean) {
  const url = new URL('/api/ws/terminal', location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('start', 'manual');
  if (sandbox) url.searchParams.set('sandbox', '1');
  if (browserSession) url.searchParams.set('browserSession', browserSession);
  return new WebSocket(url);
}

// xterm emits one mouse report per input event. Keep the latest coordinates
// so the application receives a matching button-up before another page types.
function trackMouse(s: Session, data: Uint8Array) {
  if (s.model.modes.mouseTrackingMode === 'none' || s.model.modes.mouseTrackingMode === 'x10' ||
      data[0] !== 27 || data[1] !== 91) return;
  if (data[2] === 77 && data.length === 6) {
    const code = data[3] - 32;
    if (code & 64) return;
    s.release = (code & 3) === 3 ? undefined : Uint8Array.of(27, 91, 77, 32 + (code & 28) + 3, data[4], data[5]);
  } else if (data[2] === 60 && data.length <= 64) {
    const m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(decoder.decode(data));
    if (!m || Number(m[1]) & 64) return;
    const code = Number(m[1]);
    s.release = m[4] === 'm' || (code & 3) === 3 ? undefined :
      encoder.encode('\x1b[<' + (code & ~32) + ';' + m[2] + ';' + m[3] + 'm');
  }
}
function releaseMouse(s: Session) {
  if (s.release && open(s) && s.entry.state === 'online') s.socket.send(s.release);
  s.release = undefined;
}

export class TerminalHub {
  private sessions = new Map<number, Session>();
  private ports = new Map<Port, {pending: number; dirty: boolean}>();
  private nextId = 1;
  private nextSeq = 1;
  private browserSession?: string;
  private connect: typeof terminalSocket;

  constructor(browserSession?: string, connect = terminalSocket) {
    this.browserSession = browserSession;
    this.connect = connect;
  }
  attach(port: Port) {
    if (this.ports.has(port)) return;
    this.ports.set(port, {pending:0, dirty:false});
    this.registry(port);
  }
  detach(port: Port) {
    if (!this.ports.delete(port)) return;
    for (const s of this.sessions.values()) {
      s.watches.delete(port);
      if (s.owner === port) this.transfer(s, undefined);
    }
  }
  dispose() {
    this.ports.clear();
    for (const id of this.sessions.keys()) this.remove(id);
  }
  private registry(port: Port, force = false) {
    const state = this.ports.get(port)!;
    if (state.pending && !force) { state.dirty = true; return; }
    state.dirty = false;
    state.pending = this.nextSeq++;
    const entries = Array.from(this.sessions.values(), s => ({...s.entry, owner:s.owner === port}));
    port.postMessage({type:'terminal.registry', entries, seq:state.pending});
  }
  private changed() {
    for (const port of this.ports.keys()) this.registry(port);
  }
  private sendFrame(port: Port, watch: Watch, frame: ScreenFrame) {
    const bytes = frame.type === 'terminal.output' ? frame.data.byteLength :
      frame.type === 'terminal.snapshot' ? frame.data.length * 2 : 0;
    watch.bytes += bytes;
    watch.pending.set(frame.seq, bytes);
    port.postMessage(frame);
  }
  private snapshot(s: Session, port: Port, watch: Watch) {
    watch.ready = false;
    if (watch.scheduling || watch.pending.size) return;
    watch.scheduling = true;
    // The write callback is a boundary in the canonical parser's input queue.
    // Output before it is in the snapshot; output after it will be forwarded.
    s.model.write('', () => {
      if (s.watches.get(port) !== watch) return;
      watch.scheduling = false;
      const {modes, partial} = screenState(s.model);
      this.sendFrame(port, watch, {type:'terminal.snapshot', id:s.entry.id, epoch:s.entry.epoch, seq:this.nextSeq++,
        owner:s.owner === port, cols:s.model.cols, rows:s.model.rows, data:s.serializer.serialize() + modes});
      watch.partial = partial;
      watch.epoch = s.entry.epoch;
      watch.ready = true;
    });
  }
  private publish(s: Session, content: Content) {
    for (const [port, watch] of s.watches) {
      if (!watch.ready) continue;
      // A Unicode character or VT sequence can span WebSocket frames. A new
      // viewer starts with the visible grid, then gets the completed result
      // from the canonical parser before switching to incremental updates.
      if (watch.partial) {
        if (!screenState(s.model).partial) this.snapshot(s, port, watch);
        continue;
      }
      if (watch.pending.size >= maxFrames || watch.bytes >= maxBytes) {
        this.snapshot(s, port, watch);
        continue;
      }
      this.sendFrame(port, watch, {...content, id:s.entry.id, epoch:s.entry.epoch, seq:this.nextSeq++});
    }
  }
  private ack(s: Session, port: Port, seq: number) {
    const watch = s.watches.get(port);
    const bytes = watch?.pending.get(seq);
    if (!watch || bytes === undefined) return;
    watch.pending.delete(seq);
    watch.bytes -= bytes;
    if (!watch.ready) this.snapshot(s, port, watch);
  }
  private transfer(s: Session, next: Port | undefined) {
    releaseMouse(s);
    s.owner = next;
    s.entry.epoch++;
    this.changed();
    for (const [port, watch] of s.watches) this.snapshot(s, port, watch);
  }
  private size(s: Session, port: Port, cols?: number, rows?: number) {
    if (!validSize(cols) || !validSize(rows)) return;
    const epoch = s.entry.epoch;
    s.model.write('', () => {
      if (s.owner !== port || s.entry.epoch !== epoch || !live(s) ||
          (s.model.cols === cols && s.model.rows === rows)) return;
      s.model.resize(cols, rows);
      this.publish(s, {type:'terminal.resize', cols:s.model.cols, rows:s.model.rows});
      if (s.entry.state === 'online' && open(s)) s.socket.send(JSON.stringify({cols:s.model.cols, rows:s.model.rows}));
    });
  }
  receive(port: Port, m: TerminalRequest) {
    const client = this.ports.get(port);
    if (!client) return;
    if (m.type === 'terminal.list') { this.registry(port, true); return; }
    if (m.type === 'terminal.registryAck') {
      if (m.seq === client.pending) {
        client.pending = 0;
        if (client.dirty) this.registry(port);
      }
      return;
    }
    if (m.type === 'terminal.launch') { this.launch(port, m); return; }
    if (m.type === 'terminal.remove') {
      for (const id of m.ids) this.remove(id);
      this.changed();
      return;
    }
    const s = this.sessions.get(m.id);
    if (!s) return;
    switch (m.type) {
      case 'terminal.watch': {
        if (s.watches.has(port)) return;
        const watch: Watch = {ready:false, epoch:0, partial:false, scheduling:false, bytes:0, pending:new Map()};
        s.watches.set(port, watch);
        this.snapshot(s, port, watch);
        return;
      }
      case 'terminal.unwatch':
        if (s.owner === port) releaseMouse(s);
        s.watches.delete(port);
        return;
      case 'terminal.ack': this.ack(s, port, m.seq); return;
      case 'terminal.theme':
        if (s.entry.theme !== m.theme) { s.entry.theme = m.theme; this.changed(); }
        return;
      case 'terminal.take':
        if (!live(s)) return;
        if (s.owner !== port) this.transfer(s, port);
        this.size(s, port, m.cols, m.rows);
        return;
    }
    if (s.owner !== port || s.entry.epoch !== m.epoch || s.watches.get(port)?.epoch !== m.epoch || !live(s)) return;
    if (m.type === 'terminal.size') this.size(s, port, m.cols, m.rows);
    else if (m.type === 'terminal.input' && s.entry.state === 'online' && open(s)) {
      trackMouse(s, m.data);
      for (let i = 0; i < m.data.length; i += 16384) s.socket.send(new Uint8Array(m.data.subarray(i, i + 16384)));
    }
  }
  private remove(id: number) {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    s.watches.clear();
    s.owner = undefined;
    s.socket.onopen = s.socket.onmessage = s.socket.onclose = s.socket.onerror = null;
    s.socket.close();
    s.model.dispose();
  }
  private launch(port: Port, m: Launch) {
    const {command} = m;
    const model = new headless.Terminal({cols:validSize(m.cols) ? m.cols : 80, rows:validSize(m.rows) ? m.rows : 24,
      scrollback:3000, allowProposedApi:true});
    const serializer = new SerializeAddon();
    // SerializeAddon uses buffer/parser APIs shared by browser and headless.
    model.loadAddon(serializer as unknown as ITerminalAddon);
    const socket = this.connect(this.browserSession, m.sandbox);
    socket.binaryType = 'arraybuffer';
    const id = this.nextId++;
    const cli = 'cli' in command ? {node:command.cli.node, method:command.cli.method} : undefined;
    const program = 'argv' in command ? command.argv[0]?.split('/').pop() || '' : command.cli.method;
    const s: Session = {owner:port, socket, model, serializer, watches:new Map(),
      entry:{id, cli, program, nodeName:m.nodeName, sandbox:m.sandbox, theme:m.theme, title:'', state:'connecting', detail:'starting', epoch:1}};
    this.sessions.set(id, s);
    this.changed();
    port.postMessage({type:'terminal.created', id, requestId:m.requestId});
    model.onData(data => { if (open(s) && live(s)) socket.send(encoder.encode(data)); });
    model.onTitleChange(title => {
      const value = title.trim().slice(0, 256);
      if (s.entry.title !== value) { s.entry.title = value; this.changed(); }
    });
    socket.onopen = () => {
      s.startSize = {cols:model.cols, rows:model.rows};
      socket.send(JSON.stringify({...command, ...s.startSize}));
      socket.onopen = null;
    };
    const finish = (state: TerminalState, detail: string) => {
      if (!live(s)) return;
      Object.assign(s.entry, {state, detail});
      s.release = undefined;
      const hide = encoder.encode('\x1b[?25l');
      model.write(hide, () => this.publish(s, {type:'terminal.output', data:hide}));
      this.changed();
    };
    socket.onmessage = ({data}: MessageEvent<unknown>) => {
      if (data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(data);
        model.write(bytes, () => {
          if (open(s) && bytes.length) socket.send(JSON.stringify({rendered:bytes.length}));
          this.publish(s, {type:'terminal.output', data:bytes});
        });
        return;
      }
      if (typeof data !== 'string') return;
      const info = JSON.parse(data);
      if (info.startFailed === true && s.entry.state === 'connecting') finish('failed', info.error || 'Could not start terminal');
      else if (info.started === true && s.entry.state === 'connecting') {
        Object.assign(s.entry, {state:'online', detail:'working',
          program:info.program?.split('/').pop() || s.entry.program, sandbox:info.sandboxed ?? s.entry.sandbox});
        if (s.startSize?.cols !== model.cols || s.startSize.rows !== model.rows)
          socket.send(JSON.stringify({cols:model.cols, rows:model.rows}));
        this.changed();
      } else if (typeof info.exitCode === 'number') finish(info.exitCode ? 'nonzero' : 'closed', 'exit code ' + info.exitCode);
    };
    socket.onclose = () => finish('closed', 'disconnected');
  }
}
