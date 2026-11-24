import type {Terminal} from '@xterm/xterm';

export function bindBell(term: Terminal, root: HTMLElement, signal: AbortSignal) {
  let audio: AudioContext | undefined;
  let next = 0;
  function enable() {
    if (!window.AudioContext) return;
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume().catch(() => {});
  }
  for (const type of ['pointerup', 'keydown']) root.addEventListener(type, enable, {capture: true, passive: true, signal});
  const bell = term.onBell(() => {
    if (audio?.state !== 'running' || audio.currentTime < next) return;
    const now = audio.currentTime;
    next = now + 0.09;
    const tone = audio.createOscillator();
    const volume = audio.createGain();
    tone.frequency.value = 740;
    volume.gain.setValueAtTime(0, now);
    volume.gain.linearRampToValueAtTime(0.12, now + 0.006);
    volume.gain.linearRampToValueAtTime(0, next);
    tone.connect(volume).connect(audio.destination);
    tone.onended = () => { tone.disconnect(); volume.disconnect(); };
    tone.start(now);
    tone.stop(next);
  });
  signal.addEventListener('abort', () => {
    bell.dispose();
    void audio?.close().catch(() => {});
  }, {once: true});
}
