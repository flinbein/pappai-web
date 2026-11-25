import type {Terminal} from '@xterm/xterm';
import type {TabCarousel} from './carousel';

type Point = {clientX: number; clientY: number};
type Gesture =
  | {mode: 'ignore'}
  | {mode: 'pair'; starts: Map<number, Touch>; span: number; size: number; canToggle: boolean; started: number;
     intent?: 'pinch' | 'swipe'; carousel?: TabCarousel; lastSpan: number}
  | {mode: 'tap' | 'select' | 'pan'; point: Touch; started: number; previousY: number; remainder: number};

const distance = (a: Point, b: Point) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

function pairMotion(a: Touch, b: Touch, startA: Touch, startB: Touch) {
  const dxA = a.clientX-startA.clientX, dxB = b.clientX-startB.clientX;
  const dx = (dxA+dxB)/2, dy = (a.clientY+b.clientY-startA.clientY-startB.clientY)/2;
  const span = distance(a,b);
  const horizontal = dxA*dxB > 0 && Math.min(Math.abs(dxA), Math.abs(dxB)) >= 4 &&
    Math.abs(dx) >= 10 && Math.abs(dx) > 1.5*Math.max(Math.abs(dy), Math.abs(span-distance(startA,startB)));
  return {dx, span, horizontal, opposite: dxA*dxB < 0};
}

// The launch form keeps native single-finger input, selection and scrolling.
export function bindLaunchSwipe(track: HTMLElement, carousel: TabCarousel, signal: AbortSignal) {
  const deck = track.parentElement!;
  const form = track.querySelector<HTMLElement>('#terminal-launch')!;
  let starts: Map<number, Touch> | undefined;
  let dragging = false;
  function reset() {
    if (dragging) carousel.cancel();
    dragging = false;
    starts = undefined;
  }
  deck.addEventListener('touchstart', event => {
    if (event.touches.length !== 2 || form.hidden) { reset(); return; }
    const points = Array.from(event.touches);
    if (points.every(p => p.target instanceof Node && (form.contains(p.target) || p.target === track || p.target === deck))) {
      starts = new Map(points.map(p => [p.identifier,p]));
    }
  }, {capture:true, passive:true, signal});
  deck.addEventListener('touchmove', event => {
    if (!starts || form.hidden || event.touches.length !== 2) return;
    const [a,b] = Array.from(event.touches);
    const startA = starts.get(a.identifier), startB = starts.get(b.identifier);
    if (!startA || !startB) return;
    const motion = pairMotion(a,b,startA,startB);
    if (!motion.horizontal && !dragging) return;
    dragging = true;
    if (event.cancelable) event.preventDefault();
    carousel.touch(-motion.dx);
  }, {capture:true, passive:false, signal});
  deck.addEventListener('touchend', () => {
    if (dragging) carousel.release();
    dragging = false;
    starts = undefined;
  }, {capture:true, signal});
  deck.addEventListener('touchcancel', reset, {capture:true, signal});
  signal.addEventListener('abort', reset, {once:true});
}

// Observe both the live screen and its copy overlay without taking over one-finger selection or pinch.
export function bindFullscreenTap(root: HTMLElement, toggle: () => void, signal: AbortSignal) {
  const starts = new Map<number, Point>();
  let started = 0, three = false, cancelled = false;
  function reset() { starts.clear(); three = false; cancelled = false; }
  const opts = {capture: true, passive: false, signal};
  root.addEventListener('touchstart', event => {
    if (!starts.size) started = event.timeStamp;
    for (const touch of Array.from(event.changedTouches)) {
      if (!(touch.target instanceof Element) || !touch.target.closest('.terminal-screen, .terminal-copy-mode textarea')) cancelled = true;
      starts.set(touch.identifier, touch);
    }
    if (starts.size > 3) cancelled = true;
    if (event.touches.length === 3 && !cancelled) three = true;
    if (three && event.cancelable) event.preventDefault();
  }, opts);
  function checkPosition(event: TouchEvent) {
    for (const touch of Array.from(event.changedTouches)) {
      const start = starts.get(touch.identifier);
      if (!start || distance(touch, start) > 8) cancelled = true;
    }
  }
  root.addEventListener('touchmove', checkPosition, opts);
  root.addEventListener('touchend', event => {
    checkPosition(event);
    if (three && event.cancelable) event.preventDefault();
    if (event.touches.length) return;
    const tap = three && !cancelled && event.timeStamp - started <= 350;
    reset();
    if (tap) toggle();
  }, opts);
  root.addEventListener('touchcancel', reset, opts);
}

export function bindTerminalTouch(term: Terminal, screen: HTMLElement, handles: HTMLElement,
  font: (size: number) => void, openKeyboard: () => void, toggleToolbar: () => void, signal: AbortSignal,
  carouselRef?: {readonly current: TabCarousel | null}) {
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
    const deck = screen.closest<HTMLElement>('.terminal-deck');
    const handle = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      fn(event);
    };
    const options = {capture:true, passive:false, signal};
    screen.addEventListener(type, handle, options);
    deck?.addEventListener(type, event => {
      // A second swipe can begin over the inert outgoing pane during the glide.
      if (!(event.target instanceof Element) || !event.target.matches('.terminal-track, .terminal-deck') ||
          screen.inert || (!gesture && !deck.querySelector('[data-moving]'))) return;
      const y = event.changedTouches[0]?.clientY, box = screen.getBoundingClientRect();
      if (type === 'touchstart' && (y < box.top || y >= box.bottom)) return;
      handle(event);
    }, options);
  }
  function moved(starts: Map<number, Touch>, points: TouchList) {
    return Array.from(points).some(point => {
      const start = starts.get(point.identifier);
      return !start || distance(point, start) > 8;
    });
  }
  touch('touchstart', ({touches, timeStamp}) => {
    clearTimeout(timer);
    timer = undefined;
    if (gesture?.mode === 'pair' && gesture.intent === 'swipe') gesture.carousel?.cancel();
    if (touches.length === 2) {
      const first = gesture;
      const starts = new Map(Array.from(touches, p => [p.identifier, p]));
      if (first?.mode === 'tap') starts.set(first.point.identifier, first.point);
      const span = Math.max(1, distance(touches[0], touches[1]));
      const carousel = carouselRef?.current;
      gesture = {mode: 'pair', starts, span, lastSpan: span, size: term.options.fontSize!,
        carousel: carousel?.canSwipe && (!first || first.mode === 'tap') ? carousel : undefined,
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
      if (gesture.canToggle || touches.length !== 2) return;
      const pair = gesture;
      const [a,b] = Array.from(touches);
      const startA = pair.starts.get(a.identifier), startB = pair.starts.get(b.identifier);
      if (!startA || !startB) return;
      const {dx, span, horizontal, opposite} = pairMotion(a,b,startA,startB);
      pair.lastSpan = span;
      const spanChange = Math.abs(pair.lastSpan-pair.span);
      const pinch = () => {
        if (gesture !== pair || pair.intent === 'swipe') return;
        pair.intent = 'pinch';
        clear();
        font(pair.size * pair.lastSpan / pair.span);
      };
      if (!pair.intent && pair.carousel && horizontal) {
        pair.intent = 'swipe';
        clearTimeout(timer);
      }
      if (pair.intent === 'swipe') pair.carousel!.touch(-dx);
      else if (pair.intent === 'pinch' || !pair.carousel) pinch();
      else if (spanChange >= Math.max(5,pair.span*0.045)) {
        // The two contacts may be delivered in separate updates. Give the
        // second contact time to follow before treating one moving finger as a pinch.
        if (opposite || spanChange > 2*Math.abs(dx)+4) pinch();
        else if (timer === undefined) timer = window.setTimeout(pinch,50);
      } else { clearTimeout(timer); timer = undefined; }
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
      if (gesture.intent === 'swipe' && touches.length < 2) {
        const controller = gesture.carousel!;
        gesture = touches.length ? {mode:'ignore'} : undefined;
        controller.release();
        return;
      }
      if (!gesture.intent && !gesture.canToggle && touches.length < 2 &&
          Math.abs(gesture.lastSpan - gesture.span) >= Math.max(5, gesture.span * 0.045)) {
        gesture.intent = 'pinch';
        clear();
        font(gesture.size * gesture.lastSpan / gesture.span);
      }
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
      const point = changedTouches[0];
      if (point && distance(point, gesture.point) <= 6 && term.modes.mouseTrackingMode !== 'none' && !term.options.disableStdin) {
        const {clientX, clientY} = point;
        const box = grid.getBoundingClientRect();
        if (clientX >= box.left && clientX < box.right && clientY >= box.top && clientY < box.bottom) {
          // Touch handling suppresses Chrome's compatibility mouse events. Replay a
          // completed tap through xterm before the keyboard can resize the grid.
          const mouse = {bubbles: true, cancelable: true, button: 0, clientX, clientY};
          grid.dispatchEvent(new MouseEvent('mousedown', {...mouse, buttons: 1}));
          grid.dispatchEvent(new MouseEvent('mouseup', {...mouse, buttons: 0}));
        }
      }
      openKeyboard();
    }
    if (!touches.length) gesture = undefined;
  });
  function cancelTouch() {
    clearTimeout(timer);
    if (gesture?.mode === 'pair' && gesture.intent === 'swipe') gesture.carousel?.cancel();
    gesture = undefined;
  }
  touch('touchcancel', cancelTouch);
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
    cancelTouch();
    cancelAnimationFrame(frame);
    listeners.forEach(listener => listener.dispose());
    knobs.forEach(knob => { knob.hidden = true; });
  }, {once: true});
}
