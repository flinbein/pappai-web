import {activeStaticSlide, type TabCarousel} from './carousel';
import type {Terminal} from '@xterm/xterm';

const captureWheel = {capture: true, passive: false};
const redirected = new WeakSet<WheelEvent>();
const gestureGap = 240;

function deltaInPixels(event: WheelEvent, delta: number, page: number) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * page;
  return delta;
}

export function bindScreenWheel(screen: HTMLElement, term: Terminal, setSize: (size: number) => void, signal: AbortSignal) {
  let last = -Infinity;
  let fractional = 0;
  let pendingLines = 0;
  screen.addEventListener('wheel', event => {
    if (redirected.has(event) && !event.ctrlKey && term.buffer.active.type === 'normal' &&
        (term.modes.mouseTrackingMode === 'none' || term.modes.mouseTrackingMode === 'x10')) {
      // A redispatched wheel has no native default scroll. Use the active buffer.
      const height = screen.querySelector('.xterm-screen')!.clientHeight / term.rows;
      if (height > 0) {
        pendingLines += event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY :
          deltaInPixels(event, event.deltaY, screen.clientHeight) / height;
        const lines = Math.trunc(pendingLines);
        if (lines) term.scrollLines(lines);
        pendingLines -= lines;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!event.ctrlKey || event.altKey || event.metaKey || !event.cancelable) return;
    event.preventDefault();
    event.stopPropagation();
    const current = term.options.fontSize!;
    if (event.timeStamp - last > gestureGap || Math.round(fractional) !== current) fractional = current;
    last = event.timeStamp;
    const delta = deltaInPixels(event, event.deltaY, screen.clientHeight);
    fractional = Math.max(4, Math.min(36, fractional * Math.exp(-Math.max(-16, Math.min(16, delta)) / 100)));
    setSize(Math.round(fractional));
  }, {...captureWheel, signal});
}

export function bindTabSwipe(workspace: HTMLElement, carousel: TabCarousel, signal: AbortSignal) {
  window.addEventListener('wheel', event => {
    if (redirected.has(event)) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    if (!hit || !workspace.contains(hit)) return;
    const screen = workspace.querySelector<HTMLElement>('.terminal-frame:not([hidden]) .terminal-screen:not([inert])');
    const surface = screen ?? activeStaticSlide(workspace);
    if (!surface) return;
    // During a slide, the departing pane is inert. The exposed part of the deck
    // already belongs to the incoming session for wheel input.
    const bounds = surface.getBoundingClientRect();
    if (!surface.contains(hit) && !(hit.matches('.terminal-deck, .terminal-track') &&
        event.clientY >= bounds.top && event.clientY < bounds.bottom)) return;
    const x = deltaInPixels(event, event.deltaX, workspace.clientWidth);
    const y = deltaInPixels(event, event.deltaY, workspace.clientHeight);
    const horizontal = !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey &&
      Math.abs(x) > 1.5 * Math.abs(y);
    if (horizontal) {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      const momentum = (event as WheelEvent & {momentum?: boolean}).momentum;
      if (momentum === true) carousel.release();
      else carousel.wheel(x, event.timeStamp, momentum === undefined);
      return;
    }
    if (event.ctrlKey || Math.abs(y) > Math.abs(x) * 1.5) carousel.release();
    if (screen && (!(event.target instanceof Node) || !screen.contains(event.target))) {
      // Chrome may keep the wheel target from the start of a scroll sequence.
      const overScreen = screen.contains(hit);
      const target = overScreen ? hit : screen.querySelector('.xterm-screen');
      if (!target) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      const forwarded = new WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaMode: event.deltaMode, deltaX: event.deltaX, deltaY: event.deltaY,
        clientX: event.clientX + (overScreen ? 0 : bounds.left - workspace.getBoundingClientRect().left),
        clientY: event.clientY, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey, shiftKey: event.shiftKey,
      });
      redirected.add(forwarded);
      target.dispatchEvent(forwarded);
    }
  }, {...captureWheel, signal});
}
