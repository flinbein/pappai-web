// A horizontal momentum packet ends direct manipulation. A quiet interval
// also handles slow releases that produce no fling.
const releaseDelay = 72;
const settleTime = 190;

export function activeStaticSlide(container: HTMLElement) {
  return container.querySelector<HTMLElement>('#terminal-launch:not([hidden]), .terminal-failed-frame:not([hidden]), .terminal-frame:not([hidden]) .terminal-view[data-readonly=true]');
}

export class TabCarousel {
  private ids: (number | null)[] = [];
  private index = -1;
  private releaseTimer?: number;
  private glideTimer?: number;
  private drag?: {start: number; distance: number; peak: number; valley: number; last: number};
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private track: HTMLElement, private select: (id: number | null) => void) {}

  sync(ids: (number | null)[], selected: number | null) {
    const index = ids.indexOf(selected);
    const reordered = ids.length !== this.ids.length || ids.some((id, i) => this.ids[i] !== id);
    if (!reordered && index === this.index) return;
    const animate = !reordered && this.index >= 0 && index >= 0;
    this.ids = ids;
    this.index = index;
    this.clearDrag();
    this.move(Math.max(0, index), animate);
  }

  private clearDrag() {
    clearTimeout(this.releaseTimer);
    this.drag = undefined;
  }

  private move(position: number, glide: boolean) {
    clearTimeout(this.glideTimer);
    this.track.toggleAttribute('data-glide', glide && !this.reduced.matches);
    this.track.toggleAttribute('data-moving', !this.reduced.matches && (glide || !!this.drag));
    this.track.style.transform = `translateX(${-100 * position}%)`;
    if (glide) {
      this.glideTimer = window.setTimeout(() => {
        this.track.removeAttribute('data-moving');
        this.track.removeAttribute('data-glide');
      }, settleTime + 20);
    }
  }

  private threshold(width: number) { return Math.min(80, width * 0.22); }

  get canSwipe() { return this.index >= 0; }

  private beginDrag(width: number) {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(this.track).transform);
    return {start: -matrix.m41 / width, distance: 0, peak: 0, valley: Infinity, last: 0};
  }

  private dragTo(distance: number, width: number) {
    const drag = this.drag!;
    drag.distance = Math.max(-width, Math.min(width, distance));
    if (!this.reduced.matches) {
      const position = drag.start + drag.distance / width;
      const edge = Math.max(0, Math.min(this.ids.length - 1, position));
      const overshoot = (position - edge) * width;
      const resistance = overshoot / (3 + Math.abs(overshoot) / 48);
      this.move(edge + resistance / width, false);
    }
  }

  touch(distance: number) {
    const width = this.track.clientWidth;
    if (!this.canSwipe || !width) return;
    clearTimeout(this.releaseTimer);
    this.drag ??= this.beginDrag(width);
    this.dragTo(distance, width);
  }

  cancel() {
    if (!this.drag) return;
    this.clearDrag();
    this.move(this.index, true);
  }

  wheel(delta: number, time: number, estimateMomentum: boolean) {
    const width = this.track.clientWidth;
    if (!width || this.index < 0 || !delta) return;
    const magnitude = Math.abs(delta);
    const previous = this.drag;
    if (previous) {
      const freshPush = Math.sign(delta) === Math.sign(previous.distance) &&
        Math.abs(previous.distance) >= this.threshold(width) &&
        magnitude >= Math.max(8, previous.valley * 2.2);
      if (time - previous.last >= releaseDelay || (estimateMomentum && freshPush)) this.release();
    }
    if (!this.drag) {
      // Pick up an unfinished glide exactly where it is on screen.
      this.drag = this.beginDrag(width);
    }
    const drag = this.drag;
    if (delta * drag.distance < 0) { drag.peak = 0; drag.valley = Infinity; }
    drag.peak = Math.max(drag.peak, magnitude);
    if (magnitude < drag.peak * 0.5) drag.valley = Math.min(drag.valley, magnitude);
    drag.last = time;
    this.dragTo(drag.distance + delta, width);
    clearTimeout(this.releaseTimer);
    this.releaseTimer = window.setTimeout(() => this.release(), releaseDelay);
  }

  release() {
    if (!this.drag) return;
    const distance = this.drag.distance;
    const step = Math.abs(distance) >= this.threshold(this.track.clientWidth) ? Math.sign(distance) : 0;
    const next = Math.max(0, Math.min(this.ids.length - 1, this.index + step));
    this.clearDrag();
    this.move(next, true);
    if (next !== this.index) {
      this.index = next;
      this.select(this.ids[next]);
    }
  }

  dispose() {
    this.clearDrag();
    clearTimeout(this.glideTimer);
    this.track.removeAttribute('data-glide');
    this.track.removeAttribute('data-moving');
  }
}
