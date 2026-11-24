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

export const defaultFontSize = 15;

export function openTerminal(screen: HTMLElement, fontSize: number, events: SessionEvents) {
  const term = new Terminal({cursorBlink: true, fontSize, fontFamily: 'monospace', theme: {background: '#142021'}});
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(screen);
  const url = new URL('/api/ws/terminal', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (new URLSearchParams(location.search).get('sandbox') === '1') url.search = 'sandbox=1';
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  const encoder = new TextEncoder();
  let modifiers = noModifiers;
  let issue = '';

  const online = () => socket.readyState === WebSocket.OPEN;
  function resize() {
    fit.fit();
    if (online()) socket.send(JSON.stringify({cols: term.cols, rows: term.rows}));
  }
  function send(data: Uint8Array<ArrayBuffer>) {
    for (let i = 0; online() && i < data.length; i += 16384) socket.send(data.subarray(i, i + 16384));
  }
  function setModifiers(next: Modifiers) {
    modifiers = next;
    events.modifiers(next);
  }
  function clearModifiers() {
    if (modifiers.ctrl || modifiers.alt) setModifiers(noModifiers);
  }
  function key(value: string, special = true) {
    const data = encodeKey(value, modifiers, term.modes.applicationCursorKeysMode, special);
    clearModifiers();
    send(encoder.encode(data));
  }
  term.onData(data => {
    // A mobile IME can commit a letter without a keydown. Keep terminal replies intact.
    if ((modifiers.ctrl || modifiers.alt) && data && !data.startsWith(escape)) key(data, false);
    else send(encoder.encode(data));
  });
  term.onBinary(data => send(Uint8Array.from(data, ch => ch.charCodeAt(0))));
  screen.addEventListener('paste', clearModifiers, true);
  term.attachCustomKeyEventHandler(event => {
    if (event.type !== 'keydown') return true;
    if (event.ctrlKey && event.shiftKey && ['KeyC', 'KeyV'].includes(event.code)) {
      event.preventDefault();
      if (event.code === 'KeyC') events.copy();
      else if (online()) events.paste();
      return false;
    }
    if ((modifiers.ctrl || modifiers.alt) && isSpecialKey(event.key)) {
      event.preventDefault();
      key(event.key);
      return false;
    }
    return true;
  });
  const observer = new ResizeObserver(resize);
  observer.observe(screen);
  resize();
  socket.onopen = () => {
    events.opened();
    resize();
    term.focus();
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
  socket.onerror = () => { issue ||= 'Соединение недоступно. Проверьте вход в панель.'; };
  socket.onclose = () => {
    observer.disconnect();
    term.options.disableStdin = true;
    clearModifiers();
    events.closed(issue || 'Терминал закрыт');
  };
  const close = () => socket.close();
  window.addEventListener('pagehide', close);
  return {
    term, resize, key, close, online, clearModifiers,
    modifier(name: keyof Modifiers) { setModifiers({...modifiers, [name]: !modifiers[name]}); },
    clearAlt() { if (modifiers.alt) setModifiers({...modifiers, alt: false}); },
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
