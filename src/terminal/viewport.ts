import type {TerminalSession} from './session';

type VirtualKeyboard = EventTarget & {overlaysContent: boolean; boundingRect: DOMRect; show(): void};
const keyboard = (navigator as Navigator & {virtualKeyboard?: VirtualKeyboard}).virtualKeyboard;

export function openKeyboard(session: TerminalSession) {
  if (!session.online() || !session.visible()) return;
  const input = session.term.textarea;
  // Android Back may leave the editor focused even though the IME is hidden.
  if (input && document.activeElement === input && !keyboard?.boundingRect.height) input.blur();
  session.term.focus();
  keyboard?.show();
}

export function bindViewport(root: HTMLElement, button: HTMLButtonElement, session: TerminalSession,
  report: (message: string) => void, signal: AbortSignal) {
  let normalWindow: {width: number; height: number} | undefined;
  let generation = 0;
  function layout() {
    if (signal.aborted || !root.clientHeight) return;
    const box = root.getBoundingClientRect();
    const vv = window.visualViewport;
    let edge = box.bottom;
    if (vv && vv.scale === 1) {
      const bottom = vv.offsetTop + vv.height;
      edge = Math.min(edge, bottom);
      // After either kind of fullscreen exit Chrome can restore its address bar
      // before it restores the ordinary layout height.
      if (normalWindow && !document.fullscreenElement && !document.hidden) {
        if (normalWindow.width !== innerWidth) normalWindow = undefined;
        else edge = Math.min(edge, normalWindow.height - Math.max(0, innerHeight - bottom));
      }
    }
    const inset = Math.max(0, Math.min(box.height, box.bottom - edge));
    root.style.setProperty('--terminal-ime', inset + 'px');
    if (inset > 0) root.style.setProperty('--terminal-safe', '0px');
    else root.style.removeProperty('--terminal-safe');
    const full = document.fullscreenElement === root;
    button.setAttribute('aria-label', full ? 'Exit fullscreen' : 'Enter fullscreen');
    button.title = full ? 'Exit fullscreen' : 'Enter fullscreen';
  }
  // Parent and breadcrumb geometry can change independently of the visual viewport.
  const observer = new ResizeObserver(layout);
  observer.observe(root, {box: 'border-box'});
  for (const type of ['resize', 'scroll']) window.visualViewport?.addEventListener(type, layout, {signal});
  window.addEventListener('resize', layout, {signal});
  window.addEventListener('pageshow', layout, {signal});
  keyboard?.addEventListener('geometrychange', layout, {signal});
  document.addEventListener('fullscreenchange', layout, {signal});
  const editor = (element: Element | null): element is HTMLTextAreaElement =>
    element instanceof HTMLTextAreaElement && root.contains(element);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      generation++;
      if ((document.fullscreenElement === root || normalWindow) && editor(document.activeElement)) document.activeElement.blur();
    } else {
      layout();
      requestAnimationFrame(layout);
    }
  }, {signal});
  function keyboardInset() {
    const vv = window.visualViewport;
    return Math.max(keyboard?.boundingRect.height || 0, vv?.scale === 1 ? innerHeight - vv.height - vv.offsetTop : 0);
  }
  button.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' && editor(document.activeElement) && keyboardInset() < 12) root.focus({preventScroll: true});
  }, {signal});
  async function waitForViewport(ready: () => boolean, stableMs: number, maxMs: number) {
    const start = performance.now();
    let since = start, last = '';
    while (!signal.aborted && !document.hidden && performance.now() - start < maxMs) {
      const vv = window.visualViewport;
      const size = [innerWidth, innerHeight, vv?.height, vv?.offsetTop, keyboard?.boundingRect.height].join('/');
      if (size !== last || !ready()) { since = performance.now(); last = size; }
      else if (performance.now() - since >= stableMs) return true;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return false;
  }
  button.addEventListener('click', async () => {
    const active = document.activeElement;
    const touch = matchMedia('(pointer: coarse)').matches;
    const reopen = touch && editor(active) && keyboardInset() > 60;
    // Blurring the input can change Chrome's reported height before fullscreen starts.
    const entryHeight = innerHeight;
    const before = generation;
    const interrupted = () => signal.aborted || before !== generation || document.hidden;
    button.disabled = true;
    try {
      if (touch && editor(active)) root.focus({preventScroll: true});
      if (reopen && !await waitForViewport(() => keyboardInset() < 12, 60, 1000)) {
        if (!interrupted()) report('Close the keyboard and tap ⛶ again.');
        return;
      }
      if (interrupted()) return;
      if (document.fullscreenElement === root) {
        await document.exitFullscreen();
      } else {
        if (touch) {
          normalWindow = {width: innerWidth, height: Math.min(innerHeight, entryHeight,
            normalWindow?.width === innerWidth ? normalWindow.height : Infinity)};
        }
        await root.requestFullscreen({navigationUI: 'hide'});
      }
      if (reopen) {
        if (!await waitForViewport(() => true, 180, 900) || interrupted() || !session.online()) return;
        if ([document.body, root, active].some(el => el === document.activeElement)) {
          active.focus({preventScroll: true});
          keyboard?.show();
        }
      } else if (!touch && !interrupted() && session.online()) session.term.focus();
    } catch {
      if (!interrupted()) report('Fullscreen unavailable.');
    } finally {
      button.disabled = false;
      layout();
    }
  }, {signal});
  signal.addEventListener('abort', () => {
    observer.disconnect();
    root.style.removeProperty('--terminal-ime');
    root.style.removeProperty('--terminal-safe');
  }, {once: true});
  layout();
}
