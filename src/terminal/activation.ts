/** Bind only to the selected live terminal. Ownership notifications alone must
 * never make the previous window ask for control again. */
export function bindTerminalActivation(root: HTMLElement, take: () => void) {
  const events = new AbortController();
  const {signal} = events;
  const capture = {capture:true, passive:false, signal};
  const preview = () => root.dataset.readonly === 'true';
  let focusFrame = 0;
  let previewPress = false;
  const keys = new Set<string>();

  function consume(event: Event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function activate() {
    cancelAnimationFrame(focusFrame);
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
    // A click that raises the window must finish on the preview. Give its
    // pointerdown a chance to arrive before replacing the terminal grid.
    focusFrame = requestAnimationFrame(() => {
      if (!previewPress && document.visibilityState === 'visible' && document.hasFocus()) take();
    });
  }
  window.addEventListener('focus', activate, {signal});
  document.addEventListener('visibilitychange', activate, {signal});
  window.addEventListener('blur', () => {
    cancelAnimationFrame(focusFrame);
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
      cancelAnimationFrame(focusFrame);
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
  return () => { cancelAnimationFrame(focusFrame); events.abort(); };
}
