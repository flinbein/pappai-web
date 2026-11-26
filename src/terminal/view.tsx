import type {TerminalStart} from './launch-input';
import {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';
import {CopyMode} from './copy-mode';
import {bindBell} from './bell';
import {PasteField, useTerminalClipboard} from './clipboard';
import {functionKeys, noModifiers} from './keys';
import {defaultFontSize, openTerminal, type TerminalSession} from './session';
import {bindDirectionPad, bindButtonHints, bindToolbarShortcut} from './toolbar';
import {bindFullscreenTap, bindTerminalTouch} from './touch';
import type {TabCarousel} from './carousel';
import {bindScreenWheel} from './trackpad';
import {bindViewport, openKeyboard} from './viewport';
import type {TerminalState, TerminalUpdate} from './tabs';
import {themes, ThemeChoices, themeStyle, type ThemeName} from './themes';

interface TerminalProps {
  theme: ThemeName;
  onThemeChange(theme: ThemeName): void;
  carousel?: {readonly current: TabCarousel | null};
  id: number;
  command?: TerminalStart;
  port?: MessagePort;
  owner?: boolean;
  epoch?: number;
  position: number;
  visible: boolean;
  sandbox: boolean;
  connection: TerminalState;
  update(id: number, change: TerminalUpdate): void;
}

function savedFontSize() {
  try {
    const size = Number(localStorage.getItem('terminal.fontSize'));
    if (Number.isInteger(size) && size >= 4 && size <= 36) return size;
  } catch { /* Storage is optional. */ }
  return defaultFontSize;
}

export function TerminalView({id, command, port, owner, epoch, position, visible, sandbox, connection, update, carousel, theme, onThemeChange}: TerminalProps) {
  const shared = !!port;
  const live = connection === 'connecting' || connection === 'online';
  const readOnly = shared && !owner && live;
  const consumedEnter = useRef(false);
  const takeButton = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const handles = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const notice = useRef<HTMLSpanElement>(null);
  const screenNotice = useRef<HTMLSpanElement>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const session = useRef<TerminalSession | null>(null);
  const [modifiers, setModifiers] = useState(noModifiers);
  const [toolsVisible, setToolsVisible] = useState(false);
  const [choosingTheme, setChoosingTheme] = useState(false);
  const [menu, setMenu] = useState<'input' | 'tools' | 'function'>('input');
  useLayoutEffect(() => {
    if (!visible || connection !== 'online' || !navigator.wakeLock) return;
    let generation = 0;
    let lock: WakeLockSentinel | undefined;
    async function update() {
      const request = ++generation;
      if (document.visibilityState !== 'visible') {
        void lock?.release();
        lock = undefined;
        return;
      }
      if (lock && !lock.released) return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (request === generation) lock = next;
        else await next.release();
      } catch { /* The browser or device's power policy may decline a screen lock. */ }
    }
    void update();
    document.addEventListener('visibilitychange', update);
    return () => {
      generation++;
      document.removeEventListener('visibilitychange', update);
      void lock?.release();
    };
  }, [visible, connection]);
  const report = useCallback((text: string, anchor?: HTMLElement) => {
    const keys = toolbar.current;
    const label = keys?.hidden || root.current?.querySelector('.terminal-copy-mode') ? screenNotice.current : notice.current;
    if (!label || !keys) return;
    clearTimeout(noticeTimer.current);
    if (screenNotice.current) screenNotice.current.textContent = '';
    if (notice.current) notice.current.textContent = '';
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
    const source = port && epoch !== undefined ? {id, port, epoch, owner:!!owner} : command;
    if (!source) return;
    const current = openTerminal(host.current!, savedFontSize(), source, sandbox, {
      started(program) {
        const name = program?.split('/').pop();
        update(id, {state: 'online', detail: 'working', ...(name && {program: name})});
        if (current.visible() && !matchMedia('(pointer: coarse)').matches) current.term.focus();
      },
      title(value) { if (!shared) update(id, {title: value.trim().slice(0, 256)}); },
      closed(result) {
        if ('error' in result) update(id, {state: 'failed', detail: result.error});
        else if ('exitCode' in result) update(id, {state: result.exitCode === 0 ? 'closed' : 'nonzero', detail: 'exit code ' + result.exitCode});
        else update(id, {state: 'closed', detail: 'disconnected'});
        setNativePaste(false);
      },
      modifiers: setModifiers, copy, paste,
    });
    session.current = current;
    return () => {
      clearTimeout(noticeTimer.current);
      session.current = null;
      current.dispose();
    };
  }, [id, command, port, epoch, owner, shared, sandbox, update, copy, paste, setNativePaste]);

  useLayoutEffect(() => {
    if (session.current) session.current.term.options.theme = themes[theme];
  }, [theme, id, command, port, epoch, owner, sandbox, update, copy, paste, setNativePaste]);

  useLayoutEffect(() => {
    session.current?.updateRunning?.(live);
  }, [live, port, epoch, owner]);
  useLayoutEffect(() => {
    if (!choosingTheme) return;
    if (!visible || copyView || nativePaste || !toolsVisible || menu !== 'tools') {
      setChoosingTheme(false);
      return;
    }
    const bindings = new AbortController();
    const options = {capture: true, signal: bindings.signal};
    document.addEventListener('pointerdown', event => {
      if (event.target instanceof Node && !toolbar.current?.contains(event.target)) setChoosingTheme(false);
    }, options);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setChoosingTheme(false);
    }, options);
    return () => bindings.abort();
  }, [choosingTheme, visible, copyView, nativePaste, toolsVisible, menu]);

  useLayoutEffect(() => {
    const current = session.current;
    if (!visible || !current) return;
    const scope = root.current!, keys = toolbar.current!;
    const button = (name: string) => keys.querySelector<HTMLButtonElement>(`[data-control="${name}"]`)!;
    const bindings = new AbortController();
    const {signal} = bindings;
    if (readOnly) {
      setChoosingTheme(false);
      scope.focus({preventScroll:true});
      current.resize();
      return () => bindings.abort();
    }
    function key(value: string, shift = false) {
      if (!current!.online()) return;
      current!.key(value, true, shift);
      current!.term.focus();
    }
    function toggleToolbar(row: 'input' | 'tools') {
      const show = Boolean(keys.hidden) || keys.dataset.menu !== row;
      flushSync(() => {
        setNativePaste(false);
        switchMenu(row);
        setToolsVisible(show);
      });
      current!.resize();
    }
    bindTerminalTouch(current.term, screen.current!, handles.current!, font, () => openKeyboard(current), () => toggleToolbar('input'), signal, carousel);
    bindScreenWheel(screen.current!, current.term, font, signal);
    const fullscreen = bindViewport(scope, button('fullscreen'), current, report, signal);
    bindFullscreenTap(scope, fullscreen, signal);
    bindToolbarShortcut(scope, () => toggleToolbar('tools'), fullscreen, signal);
    bindBell(current.term, scope, signal);
    bindButtonHints(scope, keys, report, signal);
    bindDirectionPad(button('arrow-pad'), 'arrows', signal, key, report);
    bindDirectionPad(button('nav-pad'), 'nav', signal, key, report);
    current.resize();
    if (!matchMedia('(pointer: coarse)').matches) {
      if (current.online() || (owner && live)) current.term.focus();
      else scope.focus({preventScroll: true});
    }
    return () => {
      bindings.abort();
      setCopyView(null);
      setNativePaste(false);
      if (scope.contains(document.activeElement) && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    };
  }, [visible, sandbox, copy, paste, report, setCopyView, setNativePaste, carousel, readOnly, epoch, owner]);

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
  const control = (name: string) => ({id: visible ? name : undefined, 'data-control': name});
  return <div className="terminal-frame" data-outside={position < 0 || undefined} style={{order:position}} inert={!visible} hidden={!visible} id={'terminal-panel-' + id}
    role="tabpanel" aria-labelledby={'terminal-tab-' + id}>
    <div ref={root} className="terminal-view" data-readonly={readOnly || undefined}
      onKeyDownCapture={event => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
        if (!event.repeat) consumedEnter.current = false;
        if (!readOnly && !consumedEnter.current) return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) { consumedEnter.current = true; takeButton.current?.click(); }
      }} onKeyUpCapture={event => {
        if (event.key === 'Enter' && consumedEnter.current) {
          consumedEnter.current = false;
          event.preventDefault();event.stopPropagation();
        }
      }} style={themeStyle(theme)} tabIndex={-1} aria-label="Terminal">
      <span ref={screenNotice} className="terminal-screen-notice" role="status"/>
      <div inert={!!copyView} ref={screen} onPointerDown={() => { if (readOnly) root.current?.focus({preventScroll:true}); }} {...control('screen')} className="terminal-screen" aria-label="Container terminal">
        <div ref={host} className="terminal-host" inert={readOnly}/>
      </div>
      <div inert={!!copyView} ref={handles} className="terminal-handles">
        <button hidden aria-label="Selection start"/><button hidden aria-label="Selection end"/>
      </div>
      <div inert={!!copyView} ref={toolbar} className="terminal-toolbar" data-menu={nativePaste ? 'paste' : menu} hidden={readOnly || (!toolsVisible && !nativePaste)} role="group" aria-label="Terminal toolbar"
        onClickCapture={event => {
          if (choosingTheme && event.target instanceof Element && !event.target.closest('[data-control="theme"], .terminal-theme-picker')) setChoosingTheme(false);
        }}
        onPointerDown={event => { if (event.target instanceof Element && event.target.closest('button')) event.preventDefault(); }}>
        <span ref={notice} className="terminal-hint" role="status"/>
        {choosingTheme && <div className="terminal-theme-picker">
          <ThemeChoices value={theme} choose={next => {onThemeChange(next); setChoosingTheme(false);}}/>
        </div>}
        <div className="terminal-key-row" role="group" hidden={nativePaste || menu !== 'input'} aria-label="Input keys">
          <div className="terminal-keys">
            <button disabled={!online} data-key="Escape" data-hint="Send Escape." onClick={() => keyPress('Escape')}>Esc</button>
            <button disabled={!online} {...control('tab')} data-hint="Send Tab. Use Shift for reverse Tab." onClick={event => keyPress('Tab', event.shiftKey)}>Tab</button>
            <button disabled={!online} {...control('arrow-pad')} aria-label="Arrow keys: drag in any direction">✥</button>
            {(['ctrl', 'alt', 'shift'] as const).map(name => <button key={name} {...control(name)} disabled={!online} aria-pressed={modifiers[name]}
              aria-label={name} data-hint={'Keep ' + name + ' on for toolbar keys. Typing releases it.'}
              onClick={() => { session.current?.modifier(name); session.current?.term.focus(); }}>{name === 'ctrl' ? 'Ctrl' : name === 'alt' ? 'Alt' : '⇧'}</button>)}
            <button disabled={!online} {...control('nav-pad')} aria-label="Navigation keys: drag for PgUp, PgDown, Home or End">Nav</button>
            <button disabled={!online} data-hint="Show function keys F1–F12." onClick={() => switchMenu('function')}>Fn</button>
            <button disabled={!online} data-hint="Send Insert." onClick={() => keyPress('Insert')}>Ins</button>
            <button disabled={!online} data-hint="Send Delete." onClick={() => keyPress('Delete')}>Del</button>
          </div>
          <button {...control('terminal-tools')} aria-label="More terminal tools" data-hint="Show clipboard, font and fullscreen controls." onClick={() => switchMenu('tools')}>☰</button>
        </div>
        {menu === 'function' && !nativePaste && <div className="terminal-key-row" role="group" aria-label="Function keys">
          <div className="terminal-keys">
            {functionKeys.map(name => <button key={name} disabled={!online} data-hint={'Send ' + name + '.'}
              onClick={() => { keyPress(name); switchMenu('input'); }}>{name}</button>)}
          </div>
          <button aria-label="Back to input keys" data-hint="Return to input keys." onClick={() => switchMenu('input')}>↩</button>
        </div>}
        <div className="terminal-key-row" role="group" hidden={nativePaste || menu !== 'tools'} aria-label="Terminal tools">
          <div className="terminal-keys">
            <button {...control('copy')} data-hint="Copy selected text or choose from scrollback." onClick={copy}>Copy</button>
            <button {...control('paste')} disabled={!online} data-hint="Paste text from the clipboard." onClick={paste}>Paste</button>
            <button {...control('font-up')} aria-label="Increase font size" data-hint="Increase the font size." onClick={() => stepFont(1)}>A+</button>
            <button {...control('font-down')} aria-label="Decrease font size" data-hint="Decrease the font size." onClick={() => stepFont(-1)}>A−</button>
            <button {...control('theme')} aria-label="Theme" aria-expanded={choosingTheme} data-hint="Choose a terminal theme."
              onClick={() => setChoosingTheme(open => !open)}>🎨</button>
            <button {...control('fullscreen')} hidden={!document.fullscreenEnabled} aria-label="Enter fullscreen" data-hint="">⛶</button>
          </div>
          <button {...control('terminal-input')} aria-label="Show input keys" data-hint="Return to input keys." onClick={() => switchMenu('input')}>⌨</button>
        </div>
        {visible && nativePaste && online && <PasteField dismiss={dismissPaste} send={text => {
          if (session.current?.online()) session.current.paste(text);
          dismissPaste();
        }}/>}
      </div>
      {readOnly && <div className="terminal-take-control"><button type="button" ref={takeButton}
        onClick={() => session.current?.take?.()}>Take control (↵)</button></div>}
      {visible && !readOnly && copyView && <CopyMode view={copyView} onClose={() => {
        flushSync(() => setCopyView(null));
        if (session.current?.visible()) {
          if (!matchMedia("(pointer: coarse)").matches && session.current.online()) session.current.term.focus();
          else root.current?.focus({preventScroll:true});
        }
      }}/>}
    </div>
  </div>;
}
