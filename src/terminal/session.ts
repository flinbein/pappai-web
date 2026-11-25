import {FitAddon} from '@xterm/addon-fit';
import {Terminal} from '@xterm/xterm';
import {encodeKey, escape, isSpecialKey, noModifiers, type Modifiers} from './keys';

type TerminalEnd = {error: string} | {exitCode: number} | {disconnected: true};
type SessionEvents = {
  started(program?: string): void;
  title(value: string): void;
  closed(result: TerminalEnd): void;
  modifiers(value: Modifiers): void;
  copy(): void;
  paste(): void;
};

export const defaultFontSize = 16;

export function openTerminal(screen: HTMLElement, fontSize: number, command: string, sandbox: boolean, events: SessionEvents) {
  const term = new Terminal({
    cursorBlink: true, fontSize, fontFamily: 'monospace', scrollback: 3000,
    theme: {background: '#12191b', foreground: '#e5eeec', selectionBackground: '#387466'},
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(screen);
  const url = new URL('/api/ws/terminal', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('start', 'manual');
  if (sandbox) url.searchParams.set('sandbox', '1');
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  const encoder = new TextEncoder();
  let modifiers = noModifiers;
  let lastSize = '';
  let started = false;
  let finished = false;

  const online = () => started && !finished && socket.readyState === WebSocket.OPEN;
  const visible = () => screen.clientWidth > 0 && screen.clientHeight > 0 && !screen.closest('.terminal-frame[hidden]');
  function resize() {
    if (!visible()) return;
    const size = fit.proposeDimensions();
    if (!size || !Number.isFinite(size.cols) || !Number.isFinite(size.rows)) return;
    term.resize(Math.min(1000, size.cols), Math.min(1000, size.rows));
    const message = JSON.stringify({cols: term.cols, rows: term.rows});
    if (online() && message !== lastSize) {
      socket.send(message);
      lastSize = message;
    }
  }
  function send(data: Uint8Array<ArrayBuffer>) {
    for (let i = 0; online() && i < data.length; i += 16384) socket.send(data.subarray(i, i + 16384));
  }
  function setModifiers(next: Modifiers) {
    modifiers = next;
    events.modifiers(next);
  }
  function clearModifiers() {
    if (modifiers.ctrl || modifiers.alt || modifiers.shift) setModifiers(noModifiers);
  }
  function key(value: string, special = true, shift = false) {
    const data = encodeKey(value, modifiers, term.modes.applicationCursorKeysMode, special, shift);
    send(encoder.encode(data));
  }
  let pasting = false;
  function paste(text: string) {
    pasting = true;
    try { term.paste(text); } finally { pasting = false; }
  }
  term.onData(data => {
    // A mobile IME can commit a letter without a keydown. Keep terminal replies intact.
    if (!pasting && (modifiers.ctrl || modifiers.alt || modifiers.shift) && data && !data.startsWith(escape)) {
      key(data, false);
      clearModifiers();
    }
    else send(encoder.encode(data));
  });
  term.onBinary(data => send(Uint8Array.from(data, ch => ch.charCodeAt(0))));
  term.onTitleChange(events.title);
  screen.addEventListener('paste', clearModifiers, true);
  term.attachCustomKeyEventHandler(event => {
    if (event.type !== 'keydown') return true;
    if (event.ctrlKey && event.shiftKey && ['KeyC', 'KeyV'].includes(event.code)) {
      event.preventDefault();
      if (event.code === 'KeyC') events.copy();
      else if (online()) { clearModifiers(); events.paste(); }
      return false;
    }
    if ((modifiers.ctrl || modifiers.alt || modifiers.shift) && isSpecialKey(event.key)) {
      event.preventDefault();
      key(event.key, true, event.shiftKey);
      clearModifiers();
      return false;
    }
    // xterm encodes these keys as escape sequences distinct from printable IME input.
    if (/^F\d+$/.test(event.key) || ['Delete', 'Insert'].includes(event.key)) clearModifiers();
    return true;
  });
  const observer = new ResizeObserver(resize);
  observer.observe(screen);
  resize();
  socket.onopen = () => {
    const dimensions = {cols: term.cols, rows: term.rows};
    lastSize = JSON.stringify(dimensions);
    socket.send(JSON.stringify({command, ...dimensions}));
  };
  function finish(result: TerminalEnd) {
    if (finished) return;
    finished = true;
    term.options.disableStdin = true;
    term.options.cursorBlink = false;
    term.write('\x1b[?25l'); // Hide the cursor after the last queued PTY output.
    clearModifiers();
    events.closed(result);
  }
  socket.onmessage = ({data}: MessageEvent<unknown>) => {
    if (data instanceof ArrayBuffer) {
      term.write(new Uint8Array(data), () => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({rendered: data.byteLength}));
      });
    } else if (typeof data === 'string') {
      const info = JSON.parse(data);
      if (info.startFailed === true && !started) {
        finish({error: info.error || 'Could not start terminal'});
      } else if (info.started === true && !started && !finished) {
        started = true;
        resize();
        events.started(info.program);
      } else if (typeof info.exitCode === 'number') {
        finish({exitCode: info.exitCode});
      }
    }
  };
  socket.onclose = () => finish({disconnected: true});
  function close() {
    socket.close();
  }
  window.addEventListener('pagehide', close);
  return {
    term, resize, key, paste, online, visible,
    modifier(name: keyof Modifiers) { setModifiers({...modifiers, [name]: !modifiers[name]}); },
    dispose() {
      window.removeEventListener('pagehide', close);
      screen.removeEventListener('paste', clearModifiers, true);
      socket.onopen = socket.onclose = socket.onmessage = socket.onerror = null;
      close();
      observer.disconnect();
      term.dispose();
    },
  };
}

export type TerminalSession = ReturnType<typeof openTerminal>;
