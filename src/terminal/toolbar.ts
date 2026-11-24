type GestureButton = HTMLButtonElement;
type Point = {id: number; x: number; y: number};
type Hint = (text: string, anchor?: HTMLElement) => void;

// Two complete Shift taps. Using Shift to type or as part of a chord cancels the gesture.
export function bindToolbarShortcut(root: HTMLElement, toggle: () => void, signal: AbortSignal) {
  let down: number | undefined;
  let released: number | undefined;
  function reset() { down = released = undefined; }
  root.addEventListener('keydown', event => {
    if (event.key !== 'Shift' || event.ctrlKey || event.altKey || event.metaKey || event.isComposing ||
        (event.target instanceof Element && event.target.closest('dialog, .terminal-native-paste'))) {
      reset();
    } else if (!event.repeat) {
      down = performance.now();
    }
  }, {capture:true, signal});
  root.addEventListener('keyup', event => {
    if (event.key !== 'Shift' || down === undefined) return;
    const now = performance.now();
    if (now - down > 350) { reset(); return; }
    down = undefined;
    if (released !== undefined && now - released <= 400) {
      reset();
      toggle();
    } else released = now;
  }, {capture:true, signal});
  root.addEventListener('focusout', reset, {signal});
  root.addEventListener('pointerdown', reset, {signal});
  window.addEventListener('blur', reset, {signal});
}

function bindPress<T extends Point>(button: GestureButton, signal: AbortSignal, handlers: {
  start(event: PointerEvent): T;
  move(press: T, event: PointerEvent): void;
  finish?(press: T, event: PointerEvent): void;
  cancel?(): void;
}) {
  let press: T | undefined;
  const label = button.textContent;
  function reset() {
    handlers.cancel?.();
    press = undefined;
    button.textContent = label;
  }
  button.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || press || button.disabled) return;
    button.setPointerCapture(event.pointerId);
    press = handlers.start(event);
  }, {signal});
  button.addEventListener('pointermove', event => {
    if (press && press.id === event.pointerId) handlers.move(press, event);
  }, {signal});
  button.addEventListener('pointerup', event => {
    if (!press || press.id !== event.pointerId) return;
    handlers.move(press, event);
    handlers.finish?.(press, event);
    reset();
  }, {signal});
  for (const type of ['pointercancel', 'lostpointercapture'] as const) {
    button.addEventListener(type, event => { if (press?.id === event.pointerId) reset(); }, {signal});
  }
  button.addEventListener('contextmenu', event => event.preventDefault(), {signal});
  window.addEventListener('blur', reset, {signal});
  window.addEventListener('pagehide', reset, {signal});
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); }, {signal});
  signal.addEventListener('abort', reset, {once: true});
}
const point = (event: PointerEvent) => ({id: event.pointerId, x: event.clientX, y: event.clientY});

// Preserve keyboard clicks and perform touch actions while the user's activation is live.
export function bindButtonHints(toolbar: HTMLElement, report: Hint, signal: AbortSignal) {
  let press: (Point & {button: HTMLButtonElement}) | undefined;
  let suppressed: HTMLButtonElement | undefined;
  let timer: number | undefined;
  function cancel() {
    clearTimeout(timer);
    press = undefined;
  }
  toolbar.addEventListener('pointerdown', event => {
    cancel();
    suppressed = undefined;
    const button = event.target instanceof Element ? event.target.closest('button[data-hint]') : null;
    if (!(button instanceof HTMLButtonElement) || !event.isPrimary || event.button !== 0 || button.disabled) return;
    press = {...point(event), button};
    timer = window.setTimeout(() => {
      suppressed = button;
      report(button.dataset.hint || button.getAttribute('aria-label') || '', button);
    }, 550);
  }, {signal});
  toolbar.addEventListener('pointermove', event => {
    if (press && press.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) {
      suppressed = press.button;
      cancel();
    }
  }, {signal});
  window.addEventListener('pointerup', event => {
    const tap = press;
    cancel();
    if (event.pointerType !== 'touch' || !tap || tap.id !== event.pointerId ||
        suppressed === tap.button || !tap.button.contains(document.elementFromPoint(event.clientX, event.clientY))) return;
    // Chrome can suppress the compatibility click immediately following an arrow drag.
    // Activate on touch release and swallow the duplicate click if Chrome emits one.
    suppressed = tap.button;
    tap.button.click();
  }, {signal});
  window.addEventListener('pointercancel', cancel, {signal});
  window.addEventListener('blur', cancel, {signal});
  toolbar.addEventListener('contextmenu', event => event.preventDefault(), {signal});
  toolbar.addEventListener('click', event => {
    if (!event.detail) return;
    // Switching rows can put a different button underneath the released finger.
    if (suppressed) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    suppressed = undefined;
  }, {capture: true, signal});
  signal.addEventListener('abort', cancel, {once: true});
}

const directions = {ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓'};
type Arrow = keyof typeof directions;

export function bindArrows(button: GestureButton, signal: AbortSignal, act: (key: Arrow, shift: boolean) => void, report: Hint) {
  let timer: number | undefined;
  const hint = () => report('Drag in any direction for arrows. Hold after dragging to repeat.', button);
  bindPress(button, signal, {
    start(event) {
      const press = {...point(event), tapped: true, locked: false};
      timer = window.setTimeout(() => {
        press.tapped = false;
        hint();
      }, 550);
      return press;
    },
    move(press, event) {
      if (press.locked) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      const x = Math.abs(dx), y = Math.abs(dy);
      if (Math.max(x, y) < 10) return;
      clearTimeout(timer);
      press.tapped = false;
      if (Math.max(x, y) < 1.25 * Math.min(x, y)) return;
      const arrow = x > y ? (dx < 0 ? 'ArrowLeft' : 'ArrowRight') : (dy < 0 ? 'ArrowUp' : 'ArrowDown');
      press.locked = true;
      button.textContent = directions[arrow];
      act(arrow, false);
      timer = window.setTimeout(function repeat() {
        act(arrow, false);
        timer = window.setTimeout(repeat, 65);
      }, 400);
    },
    finish(press) { if (press.tapped) hint(); },
    cancel: () => clearTimeout(timer),
  });
  button.addEventListener('click', event => { if (event.detail === 0) hint(); }, {signal});
  button.addEventListener('keydown', event => {
    if (Object.hasOwn(directions, event.key)) {
      event.preventDefault();
      act(event.key as Arrow, event.shiftKey);
    }
  }, {signal});
}
