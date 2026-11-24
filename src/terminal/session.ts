import {FitAddon} from '@xterm/addon-fit';
import {Terminal} from '@xterm/xterm';
import {encodeKey, escape, isSpecialKey, noModifiers, type Modifiers} from './keys';

type SessionEvents = {
  opened(): void;
  mode(sandboxed: boolean): void;
  closed(reason: string): void;
  modifiers(value: Modifiers): void;
  copy(): void;
  paste(): void;
};

export const defaultFontSize = 16;

export function openTerminal(screen: HTMLElement, fontSize: number, sandbox: boolean, events: SessionEvents) {
  const term = new Terminal({
    cursorBlink: true, fontSize, fontFamily: 'monospace', scrollback: 3000,
    theme: {background: '#12191b', foreground: '#e5eeec', selectionBackground: '#387466'},
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(screen);
  const url = new URL('/api/ws/terminal', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (sandbox) url.search = 'sandbox=1';
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  const encoder = new TextEncoder();
  let modifiers = noModifiers;
  let issue = '';
  let lastSize = '';
  let opened = false;
  let localClose = false;

  const online = () => socket.readyState === WebSocket.OPEN;
  const visible = () => screen.clientWidth > 0 && screen.clientHeight > 0;
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
    opened = true;
    events.opened();
    resize();
  };
  socket.onmessage = ({data}: MessageEvent<unknown>) => {
    if (data instanceof ArrayBuffer) {
      term.write(new Uint8Array(data), () => {
        if (online()) socket.send(JSON.stringify({rendered: data.byteLength}));
      });
    } else if (typeof data === 'string') {
      const info: {error?: string; sandboxed?: boolean} = JSON.parse(data);
      if (info.error) issue = info.error;
      else events.mode(Boolean(info.sandboxed));
    }
  };
  socket.onclose = event => {
    term.options.disableStdin = true;
    term.options.cursorBlink = false;
    term.write('\x1b[?25l'); // Hide the cursor after the last queued PTY output.
    clearModifiers();
    const ended = localClose || event.code === 1000;
    const lost = opened ? 'Соединение потеряно' : 'Соединение недоступно. Проверьте вход в панель.';
    events.closed(issue || (ended ? 'Сеанс завершён' : lost));
  };
  function close() {
    localClose = true;
    socket.close();
  }
  window.addEventListener('pagehide', close);
  return {
    term, resize, key, paste, close, online, visible,
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
