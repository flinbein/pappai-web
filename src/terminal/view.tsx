import {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';
import {bindBell} from './bell';
import {CopyDialog, PasteField, useTerminalClipboard} from './clipboard';
import {functionKeys, noModifiers} from './keys';
import {defaultFontSize, openTerminal, type TerminalSession} from './session';
import {bindArrows, bindButtonHints, bindToolbarShortcut} from './toolbar';
import {bindTerminalTouch} from './touch';
import {bindViewport, openKeyboard} from './viewport';

export type TerminalStatus = 'connecting' | 'online' | 'closed';
interface TerminalProps {
  visible: boolean;
  sandbox: boolean;
  onStatus(state: TerminalStatus): void;
}

function savedFontSize() {
  try {
    const size = Number(localStorage.getItem('terminal.fontSize'));
    if (Number.isInteger(size) && size >= 4 && size <= 36) return size;
  } catch { /* Storage is optional. */ }
  return defaultFontSize;
}

export default function TerminalView(props: TerminalProps) {
  const [started, setStarted] = useState(props.visible);
  const [generation, setGeneration] = useState(0);
  useLayoutEffect(() => { if (props.visible) setStarted(true); }, [props.visible]);
  if (!started) return null;
  return <TerminalInstance key={generation} {...props} restart={() => setGeneration(n => n + 1)}/>;
}

function TerminalInstance({visible, sandbox, onStatus, restart}: TerminalProps & {restart(): void}) {
  const root = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const handles = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const notice = useRef<HTMLSpanElement>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const session = useRef<TerminalSession | null>(null);
  const [connection, setConnection] = useState<TerminalStatus>('connecting');
  const [status, setStatus] = useState('Подключение…');
  const [modifiers, setModifiers] = useState(noModifiers);
  const [toolsVisible, setToolsVisible] = useState(false);
  const [menu, setMenu] = useState<'input' | 'tools' | 'function'>('input');
  const statusListener = useRef(onStatus);
  useLayoutEffect(() => { statusListener.current = onStatus; }, [onStatus]);
  const report = useCallback((text: string, anchor?: HTMLElement) => {
    const label = notice.current, keys = toolbar.current;
    if (!label || !keys) return;
    clearTimeout(noticeTimer.current);
    label.textContent = text;
    let left = 4;
    if (anchor) {
      const box = anchor.getBoundingClientRect();
      left = Math.max(4, Math.min(box.left - keys.getBoundingClientRect().left + (box.width - label.offsetWidth) / 2,
        keys.clientWidth - label.offsetWidth - 4));
    }
    label.style.left = left + 'px';
    noticeTimer.current = window.setTimeout(() => { label.textContent = ''; }, 2800);
  }, []);
  const {copy, paste, copyView, setCopyView, nativePaste, setNativePaste} = useTerminalClipboard(session, report);

  useLayoutEffect(() => {
    const current = openTerminal(host.current!, savedFontSize(), sandbox, {
      opened() {
        setConnection('online');
        statusListener.current('online');
        if (current.visible() && !matchMedia('(pointer: coarse)').matches) current.term.focus();
      },
      mode: sandboxed => setStatus(sandboxed ? 'В песочнице' : 'Без песочницы'),
      closed(reason) {
        setConnection('closed');
        setStatus(reason);
        setNativePaste(false);
        statusListener.current('closed');
      },
      modifiers: setModifiers, copy, paste,
    });
    session.current = current;
    setConnection('connecting');
    setStatus('Подключение…');
    statusListener.current('connecting');
    return () => {
      clearTimeout(noticeTimer.current);
      session.current = null;
      current.dispose();
    };
  }, [sandbox, copy, paste, setNativePaste]);

  useLayoutEffect(() => {
    const current = session.current;
    if (!visible || !current) return;
    const scope = root.current!, keys = toolbar.current!;
    const button = (id: string) => keys.querySelector<HTMLButtonElement>('#' + id)!;
    const bindings = new AbortController();
    const {signal} = bindings;
    function key(value: string, shift = false) {
      if (!current!.online()) return;
      current!.key(value, true, shift);
      current!.term.focus();
    }
    function toggleToolbar() {
      const show = Boolean(keys.hidden);
      flushSync(() => {
        setNativePaste(false);
        setToolsVisible(show);
      });
      current!.resize();
    }
    bindTerminalTouch(current.term, screen.current!, handles.current!, font, () => openKeyboard(current), toggleToolbar, signal);
    bindToolbarShortcut(scope, toggleToolbar, signal);
    bindViewport(scope, button('fullscreen'), current, report, signal);
    bindBell(current.term, scope, signal);
    bindButtonHints(keys, report, signal);
    bindArrows(button('arrow-pad'), signal, key, report);
    current.resize();
    if (current.online() && !matchMedia('(pointer: coarse)').matches) current.term.focus();
    return () => {
      bindings.abort();
      setCopyView(null);
      setNativePaste(false);
      if (scope.contains(document.activeElement) && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    };
  }, [visible, sandbox, copy, paste, report, setCopyView, setNativePaste]);

  function font(size: number) {
    const current = session.current;
    if (!current) return;
    const next = Math.max(4, Math.min(36, Math.round(size)));
    if (current.term.options.fontSize === next) return;
    current.term.options.fontSize = next;
    current.resize();
    try { localStorage.setItem('terminal.fontSize', String(next)); } catch { /* Keep this session's font. */ }
  }

  function dismissPaste() {
    setNativePaste(false);
    if (session.current) openKeyboard(session.current);
  }
  function keyPress(key: string, shift = false) {
    session.current?.key(key, true, shift);
    session.current?.term.focus();
  }
  function stepFont(step: number) {
    if (session.current) font(session.current.term.options.fontSize! + step);
  }
  function switchMenu(next: typeof menu) {
    if (notice.current) notice.current.textContent = '';
    setMenu(next);
  }
  const online = connection === 'online';
  const closed = connection === 'closed';
  return <div className="terminal-frame" hidden={!visible}>
    <div className="terminal-statusbar">
      <span className="terminal-state" data-state={connection} role="status" title="Double-tap Shift to toggle terminal keys">{status}</span>
      <button id="disconnect" aria-label={closed ? 'New terminal' : 'Close terminal'}
        onClick={closed ? restart : () => session.current?.close()}>{closed ? 'New terminal' : 'Close terminal'}</button>
    </div>
    <div ref={root} className="terminal-view" tabIndex={-1} aria-label="Terminal">
      <div ref={screen} id="screen" className="terminal-screen" aria-label="Container terminal">
        <div ref={host} className="terminal-host"/>
      </div>
      <div ref={handles} className="terminal-handles">
        <button hidden aria-label="Selection start"/><button hidden aria-label="Selection end"/>
      </div>
      <div ref={toolbar} className="terminal-toolbar" hidden={!toolsVisible && !nativePaste} role="group" aria-label="Terminal toolbar"
        onPointerDown={event => { if (event.target instanceof Element && event.target.closest('button')) event.preventDefault(); }}>
        <span ref={notice} className="terminal-hint" role="status"/>
        <div className="terminal-keys" hidden={nativePaste || menu !== 'input'} aria-label="Input keys">
          <button disabled={!online} data-key="Escape" data-hint="Send Escape." onClick={() => keyPress('Escape')}>Esc</button>
          <button disabled={!online} id="tab" data-hint="Send Tab. Use Shift for reverse Tab." onClick={event => keyPress('Tab', event.shiftKey)}>Tab</button>
          <button disabled={!online} id="arrow-pad" aria-label="Arrow keys: drag in any direction">✥</button>
          {(['ctrl', 'alt', 'shift'] as const).map(name => <button key={name} id={name} disabled={!online} aria-pressed={modifiers[name]}
            aria-label={name} data-hint={'Keep ' + name + ' on for toolbar keys. Typing releases it.'}
            onClick={() => { session.current?.modifier(name); session.current?.term.focus(); }}>{name === 'ctrl' ? 'Ctrl' : name === 'alt' ? 'Alt' : '⇧'}</button>)}
          <button disabled={!online} data-hint="Show function keys F1–F12." onClick={() => switchMenu('function')}>Fn</button>
          <button className="terminal-menu-switch" id="terminal-tools" aria-label="More terminal tools" data-hint="Show clipboard, font and fullscreen controls." onClick={() => switchMenu('tools')}>☰</button>
        </div>
        {menu === 'function' && !nativePaste && <div className="terminal-function-row" role="group" aria-label="Function keys">
          <div className="terminal-keys">
            {functionKeys.map(name => <button key={name} disabled={!online} data-hint={'Send ' + name + '.'}
              onClick={() => { keyPress(name); switchMenu('input'); }}>{name}</button>)}
          </div>
          <button aria-label="Back to input keys" data-hint="Return to input keys." onClick={() => switchMenu('input')}>↩</button>
        </div>}
        <div className="terminal-keys" hidden={nativePaste || menu !== 'tools'} aria-label="Terminal tools">
          <button id="copy" data-hint="Copy selected text or choose from scrollback." onClick={copy}>Copy</button>
          <button id="paste" disabled={!online} data-hint="Paste text from the clipboard." onClick={paste}>Paste</button>
          <button id="font-up" aria-label="Increase font size" data-hint="Increase the font size." onClick={() => stepFont(1)}>A+</button>
          <button id="font-down" aria-label="Decrease font size" data-hint="Decrease the font size." onClick={() => stepFont(-1)}>A−</button>
          <button id="fullscreen" hidden={!document.fullscreenEnabled} aria-label="Enter fullscreen" data-hint="">⛶</button>
          <button className="terminal-menu-switch" id="terminal-input" aria-label="Show input keys" data-hint="Return to input keys." onClick={() => switchMenu('input')}>⌨</button>
        </div>
        {visible && nativePaste && online && <PasteField dismiss={dismissPaste} send={text => {
          if (session.current?.online()) session.current.paste(text);
          dismissPaste();
        }}/>}
      </div>
      {visible && copyView && <CopyDialog view={copyView} report={report} onClose={() => {
        setCopyView(null);
        if (session.current?.online() && session.current.visible()) session.current.term.focus();
      }}/>}
    </div>
  </div>;
}
