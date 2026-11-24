type GestureButton = HTMLButtonElement;
type Point = {id: number; x: number; y: number};
type Hint = (text: string, anchor?: HTMLElement) => void;

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

export function bindVerticalKey(button: GestureButton, signal: AbortSignal, actions: {
  up(): void; down?(): void; tap(shift: boolean): void; upLabel?: string; threshold?: number;
}) {
  type Action = 'tap' | 'up' | 'down' | 'scroll';
  bindPress(button, signal, {
    start: event => ({...point(event), shift: event.shiftKey, action: 'tap' as Action}),
    move(press, event) {
      if (press.action !== 'tap') return;
      const dx = Math.abs(event.clientX - press.x);
      const dy = event.clientY - press.y;
      if (Math.max(dx, Math.abs(dy)) < (actions.threshold ?? 16)) return;
      press.action = dx >= Math.abs(dy) ? 'scroll' : dy < 0 ? 'up' : 'down';
      if (press.action === 'up' && actions.upLabel) button.textContent = actions.upLabel;
    },
    finish({action, shift}, event) {
      if (action === 'tap') actions.tap(shift || event.shiftKey);
      if (action === 'up') actions.up();
      if (action === 'down') actions.down?.();
    },
  });
  button.addEventListener('click', event => { if (event.detail === 0) actions.tap(event.shiftKey); }, {signal});
}

export function bindFontKey(button: GestureButton, signal: AbortSignal, getSize: () => number,
  setSize: (size: number) => void, defaultSize: number, report: Hint) {
  let timer: number | undefined;
  const hint = () => report('Drag up for larger text or down for smaller text. Hold to reset.', button);
  bindPress(button, signal, {
    start(event) {
      const press = {...point(event), mode: 'tap', size: getSize()};
      button.textContent = String(press.size);
      timer = window.setTimeout(() => {
        press.mode = 'reset';
        setSize(defaultSize);
        button.textContent = String(getSize());
      }, 550);
      return press;
    },
    move(press, event) {
      const dx = Math.abs(event.clientX - press.x);
      const dy = press.y - event.clientY;
      if (press.mode === 'tap' && Math.max(dx, Math.abs(dy)) >= 10) {
        clearTimeout(timer);
        press.mode = Math.abs(dy) > dx ? 'resize' : 'scroll';
      }
      if (press.mode === 'resize') {
        setSize(press.size + Math.trunc(dy / 10));
        button.textContent = String(getSize());
      }
    },
    finish(press) { if (press.mode === 'tap') hint(); },
    cancel: () => clearTimeout(timer),
  });
  button.addEventListener('click', event => { if (event.detail === 0) hint(); }, {signal});
  button.addEventListener('keydown', event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    setSize(getSize() + (event.key === 'ArrowUp' ? 1 : -1));
  }, {signal});
}

const directions = {ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓'};
type Arrow = keyof typeof directions;

export function bindArrows(button: GestureButton, signal: AbortSignal, act: (key: Arrow, shift: boolean) => void, report: Hint) {
  let timer: number | undefined;
  const hint = () => report('Drag in any direction for arrows. Hold first for Shift. Hold after dragging to repeat.', button);
  bindPress(button, signal, {
    start(event) {
      const press = {...point(event), shift: event.shiftKey, tapped: true, locked: false};
      timer = window.setTimeout(() => {
        press.shift = true;
        press.tapped = false;
        button.textContent = '⇧';
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
      button.textContent = (press.shift ? '⇧' : '') + directions[arrow];
      act(arrow, press.shift);
      timer = window.setTimeout(function repeat() {
        act(arrow, press.shift);
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
