import type {TerminalSession} from './session';

type VirtualKeyboard = EventTarget & {overlaysContent: boolean; boundingRect: DOMRect; show(): void};
const keyboard = (navigator as Navigator & {virtualKeyboard?: VirtualKeyboard}).virtualKeyboard;
export function keyboardInset() {
  const vv = window.visualViewport;
  return Math.max(keyboard?.boundingRect.height || 0, vv?.scale === 1 ? innerHeight - vv.height - vv.offsetTop : 0);
}

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
  const fullscreenTarget = root.closest<HTMLElement>('.terminal-workspace') ?? root;
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
    root.style.setProperty('--terminal-visible-height', (box.height - inset) + 'px');
    root.style.setProperty('--terminal-ime', inset + 'px');
    if (inset > 0) root.style.setProperty('--terminal-safe', '0px');
    else root.style.removeProperty('--terminal-safe');
    const full = document.fullscreenElement === fullscreenTarget;
    button.setAttribute('aria-label', full ? 'Exit fullscreen' : 'Enter fullscreen');
    button.title = (full ? 'Exit fullscreen' : 'Enter fullscreen') + ' · Ctrl+Shift+Enter';
    button.dataset.hint = button.title;
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
      if ((document.fullscreenElement === fullscreenTarget || normalWindow) && editor(document.activeElement)) document.activeElement.blur();
    } else {
      layout();
      requestAnimationFrame(layout);
    }
  }, {signal});
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
  async function toggleFullscreen() {
    if (button.disabled) return;
    if (!document.fullscreenEnabled) { report('Fullscreen is unavailable in this browser view.'); return; }
    const exiting = document.fullscreenElement === fullscreenTarget;
    if (!exiting && !navigator.userActivation.isActive) {
      report('Press Ctrl+Shift+Enter or tap ⛶ to enter fullscreen.');
      return;
    }
    const active = document.activeElement;
    const touch = matchMedia('(pointer: coarse)').matches;
    const editable = editor(active) && !active.readOnly;
    const reopen = touch && editable && keyboardInset() > 60;
    // Blurring the input can change Chrome's reported height before fullscreen starts.
    const entryHeight = innerHeight;
    const before = generation;
    const interrupted = () => signal.aborted || before !== generation || document.hidden;
    button.disabled = true;
    try {
      if (touch && editable) root.focus({preventScroll: true});
      // Request fullscreen during the gesture. IME dismissal may resize the
      // viewport late or leave its reported inset nonzero during the transition.
      if (exiting) {
        await document.exitFullscreen();
      } else {
        if (touch) {
          normalWindow = {width: innerWidth, height: Math.min(innerHeight, entryHeight,
            normalWindow?.width === innerWidth ? normalWindow.height : Infinity)};
        }
        await fullscreenTarget.requestFullscreen({navigationUI: 'hide'});
      }
      if (reopen) {
        if (!await waitForViewport(() => true, 180, 900) || interrupted() || !session.online()) return;
        if ([document.body, root, active].some(el => el === document.activeElement)) {
          active.focus({preventScroll: true});
          keyboard?.show();
        }
      } else if (!touch && !interrupted() && session.online() && !root.querySelector('.terminal-copy-mode')) session.term.focus();
    } catch (error) {
      if (!interrupted()) report(error instanceof Error ? 'Fullscreen: ' + error.message : 'Fullscreen unavailable.');
    } finally {
      button.disabled = false;
      layout();
    }
  }
  button.addEventListener('click', toggleFullscreen, {signal});
  signal.addEventListener('abort', () => {
    observer.disconnect();
    root.style.removeProperty('--terminal-ime');
    root.style.removeProperty('--terminal-safe');
  }, {once: true});
  layout();
  return toggleFullscreen;
}
