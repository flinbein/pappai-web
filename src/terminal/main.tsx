import {useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';
import {ClipboardDialog, useTerminalClipboard} from './clipboard';
import {noModifiers} from './keys';
import {defaultFontSize, openTerminal, type TerminalSession} from './session';

function savedFontSize() {
  try {
    const saved = Number(localStorage.getItem('terminal.fontSize'));
    if (Number.isInteger(saved) && saved >= 10 && saved <= 28) return saved;
  } catch { /* Storage can be disabled in the browser. */ }
  return defaultFontSize;
}

function TerminalPage() {
  const screen = useRef<HTMLDivElement>(null);
  const session = useRef<TerminalSession | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'online' | 'closed'>('connecting');
  const [status, setStatus] = useState('Подключение…');
  const [modifiers, setModifiers] = useState(noModifiers);
  const [more, setMore] = useState(false);
  const [fontSize, setFontSize] = useState(savedFontSize);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<number | undefined>(undefined);
  const report = useCallback((message: string) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 2500);
  }, []);
  const {view, setView, copy, paste, disconnect} = useTerminalClipboard(session, report);

  useEffect(() => {
    if (!screen.current) return;
    const current = openTerminal(screen.current, savedFontSize(), {
      opened: () => setConnection('online'),
      mode: sandboxed => setStatus(sandboxed ? 'В песочнице' : 'Без песочницы'),
      closed(reason) {
        setConnection('closed');
        setStatus(reason);
        disconnect();
      },
      modifiers: setModifiers, copy, paste,
    });
    session.current = current;
    function viewportHeight() {
      const viewport = window.visualViewport;
      if (viewport?.scale === 1) document.body.style.setProperty('--terminal-height', viewport.height + 'px');
      else document.body.style.removeProperty('--terminal-height');
    }
    function fullscreenChange() {
      setFullscreen(!!document.fullscreenElement);
      current.resize();
    }
    viewportHeight();
    window.visualViewport?.addEventListener('resize', viewportHeight);
    document.addEventListener('fullscreenchange', fullscreenChange);
    return () => {
      window.visualViewport?.removeEventListener('resize', viewportHeight);
      document.body.style.removeProperty('--terminal-height');
      document.removeEventListener('fullscreenchange', fullscreenChange);
      window.clearTimeout(noticeTimer.current);
      current.dispose();
      session.current = null;
    };
  }, [copy, paste, disconnect]);

  function font(size: number) {
    const current = session.current;
    if (!current) return;
    current.term.options.fontSize = size;
    setFontSize(size);
    current.resize();
    try { localStorage.setItem('terminal.fontSize', String(size)); } catch { /* Font still applies to this tab. */ }
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      session.current?.term.focus();
    } catch { report('Полноэкранный режим недоступен'); }
  }
  function toggleMore() {
    if (more) session.current?.clearAlt();
    setMore(!more);
  }
  const online = connection === 'online';
  const closed = connection === 'closed';
  const disconnectLabel = closed ? 'Открыть новый терминал' : 'Закрыть терминал';
  const fullLabel = fullscreen ? 'Выйти из полного экрана' : 'На весь экран';
  function key(value: string, label: string = value, description?: string) {
    return <button key={value} data-key={value} aria-label={description} disabled={!online}
      onClick={() => session.current?.key(value)}>{label}</button>;
  }
  return <>
    <header>
      <div className="terminal-title"><strong>Терминал</strong><span id="state" role="status">{status}</span></div>
      <button id="copy" type="button" onPointerDown={e => e.preventDefault()} onClick={copy}>Копировать</button>
      <button id="paste" type="button" onPointerDown={e => e.preventDefault()} onClick={paste} disabled={!online}>Вставить</button>
      <button id="fullscreen" type="button" aria-label={fullLabel} title={fullLabel}
        hidden={!document.fullscreenEnabled} onClick={toggleFullscreen}>⛶</button>
      <button id="disconnect" type="button" aria-label={disconnectLabel} title={disconnectLabel}
        data-closed={closed ? '' : undefined} onClick={() => closed ? location.reload() : session.current?.close()}>
        {closed ? 'Открыть новый' : '×'}
      </button>
    </header>
    <div ref={screen} id="screen" aria-label="Терминал контейнера"/>
    <div id="terminal-notice" role="status">{notice}</div>
    <div id="keybar" aria-label="Клавиши терминала" role="group"
      onPointerDown={e => { if (e.target instanceof Element && e.target.closest('button')) e.preventDefault(); }}
      onClick={() => session.current?.term.focus()}>
      <div className="key-row">
        {key('Escape', 'Esc')}{key('Tab')}
        <button id="ctrl" disabled={!online} aria-pressed={modifiers.ctrl} onClick={() => session.current?.modifier('ctrl')}>Ctrl</button>
        {key('ArrowLeft', '←', 'Влево')}{key('ArrowDown', '↓', 'Вниз')}{key('ArrowUp', '↑', 'Вверх')}{key('ArrowRight', '→', 'Вправо')}
        <button id="more" aria-expanded={more} aria-controls="extra-keys"
          aria-label="Дополнительные клавиши и размер шрифта" onClick={toggleMore}>⋯</button>
      </div>
      <div id="extra-keys" hidden={!more}>
        <div className="key-row">
          <button id="alt" disabled={!online} aria-pressed={modifiers.alt} onClick={() => session.current?.modifier('alt')}>Alt</button>
          {key('Home')}{key('End')}{key('PageUp', 'PgUp')}{key('PageDown', 'PgDn')}{key('/')}{key('|')}{key('-')}
        </div>
        <div className="font-row"><span>Шрифт</span>
          <button id="smaller" aria-label="Уменьшить шрифт" disabled={fontSize <= 10} onClick={() => font(fontSize - 1)}>A−</button>
          <button id="font-reset" aria-label="Сбросить размер шрифта" title="Сбросить размер шрифта"
            onClick={() => font(defaultFontSize)}>{fontSize} px</button>
          <button id="larger" aria-label="Увеличить шрифт" disabled={fontSize >= 28} onClick={() => font(fontSize + 1)}>A+</button>
        </div>
      </div>
    </div>
    <ClipboardDialog view={view} session={session.current} report={report}
      onClose={() => { setView(null); session.current?.term.focus(); }}/>
  </>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<TerminalPage/>);
