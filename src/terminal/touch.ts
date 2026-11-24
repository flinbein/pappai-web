import type {Terminal} from '@xterm/xterm';

type Point = {clientX: number; clientY: number};
type Gesture =
  | {mode: 'ignore'}
  | {mode: 'pair'; starts: Map<number, Touch>; span: number; size: number; canToggle: boolean; started: number}
  | {mode: 'tap' | 'select' | 'pan'; point: Touch; started: number; previousY: number; remainder: number};

const distance = (a: Point, b: Point) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

export function bindTerminalTouch(term: Terminal, screen: HTMLElement, handles: HTMLElement,
  font: (size: number) => void, openKeyboard: () => void, toggleToolbar: () => void, signal: AbortSignal) {
  const grid = screen.querySelector<HTMLElement>('.xterm-screen')!;
  const knobs = Array.from(handles.querySelectorAll('button'));
  let gesture: Gesture | undefined;
  let timer: number | undefined;
  let range: [number, number] | undefined;
  let drag: {index: number; x: number; y: number} | undefined;
  let frame = 0;

  function geometry() {
    const box = grid.getBoundingClientRect();
    return {box, width: box.width / term.cols, height: box.height / term.rows};
  }
  function cell(x: number, y: number) {
    const {box, width, height} = geometry();
    const col = Math.max(0, Math.min(term.cols - 1, Math.floor((x - box.left) / width)));
    const row = Math.max(0, Math.min(term.rows - 1, Math.floor((y - box.top) / height))) + term.buffer.active.viewportY;
    const wideTail = term.buffer.active.getLine(row)?.getCell(col)?.getWidth() === 0;
    return row * term.cols + (wideTail ? Math.max(0, col - 1) : col);
  }
  function markers() {
    const {box, width, height} = geometry();
    const parent = handles.getBoundingClientRect();
    knobs.forEach((knob, index) => {
      if (!range || !term.hasSelection()) { knob.hidden = true; return; }
      const pos = index ? range[1] - 1 : range[0];
      const row = Math.floor(pos / term.cols) - term.buffer.active.viewportY;
      knob.hidden = row < 0 || row >= term.rows;
      knob.style.left = box.left - parent.left + (pos % term.cols + index) * width + 'px';
      knob.style.top = box.top - parent.top + (row + index) * height + 'px';
    });
  }
  function paint() {
    if (range) term.select(range[0] % term.cols, Math.floor(range[0] / term.cols), range[1] - range[0]);
    markers();
  }
  function clear() {
    range = undefined;
    term.clearSelection();
    markers();
  }
  function selectWord(pos: number) {
    const row = Math.floor(pos / term.cols);
    const line = term.buffer.active.getLine(row);
    if (!line) return;
    const word = (c: number) => /[\p{L}\p{N}_]/u.test(line.getCell(c)?.getChars() || '');
    let start = pos % term.cols;
    let end = start + Math.max(1, line.getCell(start)?.getWidth() || 1);
    if (word(start)) {
      while (start > 0 && (word(start - 1) || line.getCell(start - 1)?.getWidth() === 0)) start--;
      while (end < term.cols && word(end)) end += Math.max(1, line.getCell(end)?.getWidth() || 1);
    }
    range = [row * term.cols + start, row * term.cols + end];
    paint();
  }
  function touch(type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', fn: (event: TouchEvent) => void) {
    screen.addEventListener(type, event => {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      fn(event);
    }, {capture: true, passive: false, signal});
  }
  function moved(starts: Map<number, Touch>, points: TouchList) {
    return Array.from(points).some(point => {
      const start = starts.get(point.identifier);
      return !start || distance(point, start) > 8;
    });
  }
  touch('touchstart', ({touches, timeStamp}) => {
    clearTimeout(timer);
    if (touches.length === 2) {
      const first = gesture;
      const starts = new Map(Array.from(touches, p => [p.identifier, p]));
      if (first?.mode === 'tap') starts.set(first.point.identifier, first.point);
      gesture = {mode: 'pair', starts, span: Math.max(1, distance(touches[0], touches[1])), size: term.options.fontSize!,
        canToggle: (!first || first.mode === 'tap') && !moved(starts, touches), started: first?.mode === 'tap' ? first.started : timeStamp};
      return;
    }
    if (touches.length !== 1) { gesture = {mode: 'ignore'}; return; }
    const point = touches[0];
    gesture = {mode: 'tap', point, started: timeStamp, previousY: point.clientY, remainder: 0};
    timer = window.setTimeout(() => {
      if (gesture?.mode !== 'tap') return;
      gesture.mode = 'select';
      selectWord(cell(point.clientX, point.clientY));
    }, 430);
  });
  touch('touchmove', ({touches}) => {
    if (!gesture || gesture.mode === 'ignore') return;
    if (gesture.mode === 'pair') {
      if (moved(gesture.starts, touches)) gesture.canToggle = false;
      if (!gesture.canToggle && touches.length === 2) {
        clear();
        font(gesture.size * distance(touches[0], touches[1]) / gesture.span);
      }
      return;
    }
    if (touches.length !== 1) return;
    const point = touches[0];
    const {clientX: x, clientY: y} = point;
    if (gesture.mode === 'tap' && distance(point, gesture.point) > 6) {
      clearTimeout(timer);
      clear();
      gesture.mode = 'pan';
    }
    if (gesture.mode === 'pan') {
      gesture.remainder += (gesture.previousY - y) / geometry().height;
      gesture.previousY = y;
      const lines = Math.trunc(gesture.remainder);
      if (!lines || !Number.isFinite(lines)) return;
      gesture.remainder -= lines;
      const tracking = term.modes.mouseTrackingMode;
      if (tracking === 'none' || tracking === 'x10' || term.options.disableStdin) term.scrollLines(lines);
      else for (let i = 0; i < Math.abs(lines); i++) {
        // Let xterm choose the encoding and coordinates for the active mouse protocol.
        grid.dispatchEvent(new WheelEvent('wheel', {bubbles: true, cancelable: true, clientX: x, clientY: y,
          deltaMode: WheelEvent.DOM_DELTA_LINE, deltaY: Math.sign(lines)}));
      }
    } else if (gesture.mode === 'select' && range && distance(point, gesture.point) > 6) {
      const anchor = cell(gesture.point.clientX, gesture.point.clientY);
      const here = cell(x, y);
      range = [Math.min(here, anchor), Math.max(here, anchor) + 1];
      paint();
    }
  });
  touch('touchend', ({touches, changedTouches, timeStamp}) => {
    clearTimeout(timer);
    if (gesture?.mode === 'pair') {
      if (moved(gesture.starts, changedTouches)) gesture.canToggle = false;
      if (!touches.length && gesture.canToggle && timeStamp - gesture.started <= 350) {
        // xterm clears selection on a row-count change. Restore it after the toolbar fits.
        const selected = term.hasSelection() ? range : undefined;
        const columns = term.cols;
        toggleToolbar();
        if (selected && columns === term.cols) { range = selected; paint(); }
      }
    } else if (!touches.length && gesture?.mode === 'tap') {
      clear();
      openKeyboard();
    }
    if (!touches.length) gesture = undefined;
  });
  touch('touchcancel', () => { clearTimeout(timer); gesture = undefined; });
  screen.addEventListener('contextmenu', event => { if (gesture || range) event.preventDefault(); }, {signal});
  function extend() {
    if (!drag || !range) return;
    const {box, height} = geometry();
    const edge = drag.y < box.top + height ? -1 : drag.y > box.bottom - height ? 1 : 0;
    if (edge) term.scrollLines(edge);
    const pos = cell(drag.x, drag.y);
    if (drag.index === 0) range[0] = Math.min(pos, range[1] - 1);
    else range[1] = Math.max(pos + 1, range[0] + 1);
    paint();
    if (edge) frame = requestAnimationFrame(extend);
  }
  knobs.forEach((knob, index) => {
    knob.addEventListener('pointerdown', e => {
      e.preventDefault();
      knob.setPointerCapture(e.pointerId);
      drag = {index, x: e.clientX, y: e.clientY};
    }, {signal});
    knob.addEventListener('pointermove', e => {
      if (drag?.index !== index) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      cancelAnimationFrame(frame);
      extend();
    }, {signal});
    knob.addEventListener('lostpointercapture', () => { drag = undefined; cancelAnimationFrame(frame); }, {signal});
  });
  const listeners = [term.onScroll(markers), term.onSelectionChange(markers), term.onResize(clear)];
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    listeners.forEach(listener => listener.dispose());
    knobs.forEach(knob => { knob.hidden = true; });
  }, {once: true});
}
