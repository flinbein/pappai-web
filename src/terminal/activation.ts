const focusDelayMs = 200;

/** Bind only to the selected live terminal. Ownership notifications alone must
 * never make the previous window ask for control again. */
export function bindTerminalActivation(root: HTMLElement, take: () => void) {
  const events = new AbortController();
  const {signal} = events;
  const capture = {capture:true, passive:false, signal};
  const preview = () => root.dataset.readonly === 'true';
  let focusTimer = 0;
  let pointerHeld = false;
  let previewPress = false;
  const keys = new Set<string>();

  function consume(event: Event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function activate() {
    clearTimeout(focusTimer);
    if (pointerHeld || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    focusTimer = window.setTimeout(() => {
      if (preview() && !pointerHeld && document.visibilityState === 'visible' && document.hasFocus()) take();
    }, focusDelayMs);
  }
  // A tab-strip press can precede or follow window focus, and the user can
  // hold it longer than the delay. Only the eventual selection may claim a PTY.
  document.addEventListener('pointerdown', () => {
    pointerHeld = true;
    clearTimeout(focusTimer);
  }, capture);
  const releasePointer = () => { pointerHeld = false; };
  document.addEventListener('pointerup', releasePointer, capture);
  document.addEventListener('pointercancel', releasePointer, capture);
  window.addEventListener('wheel', event => {
    if (Math.abs(event.deltaX) > 1.5 * Math.abs(event.deltaY) && !event.ctrlKey) clearTimeout(focusTimer);
  }, {capture:true, passive:true, signal});
  window.addEventListener('focus', activate, {signal});
  document.addEventListener('visibilitychange', activate, {signal});
  window.addEventListener('blur', () => {
    clearTimeout(focusTimer);
    pointerHeld = false;
    keys.clear();
    previewPress = false;
  }, {signal});

  root.addEventListener('keydown', event => {
    const key = event.code || event.key;
    if (!event.repeat) keys.delete(key);
    if (!preview() && !keys.size) return;
    consume(event);
    // Consume the whole activating chord, even if ownership arrives between
    // Ctrl and C, or before the keyboard generates a repeat.
    if (!keys.size && preview()) take();
    keys.add(key);
  }, capture);
  root.addEventListener('keyup', event => {
    if (keys.delete(event.code || event.key)) consume(event);
  }, capture);

  root.addEventListener('pointerdown', event => {
    previewPress = preview();
    if (previewPress) {
      consume(event);
    }
  }, capture);
  root.addEventListener('pointercancel', () => { previewPress = false; }, capture);
  root.addEventListener('pointerup', event => {
    if (previewPress) consume(event);
  }, capture);
  const finishPress = (event: Event) => {
    if (!previewPress && !preview()) return;
    previewPress = false;
    consume(event);
    if (preview()) take();
  };
  root.addEventListener('click', finishPress, capture);
  root.addEventListener('auxclick', finishPress, capture);
  root.addEventListener('contextmenu', event => {
    if (previewPress || preview()) consume(event);
  }, capture);

  activate();
  return () => { clearTimeout(focusTimer); events.abort(); };
}
