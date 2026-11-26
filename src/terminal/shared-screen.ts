import type {Terminal} from '@xterm/xterm';
import type {FitAddon} from '@xterm/addon-fit';
import {useWorkerDeviceReplies, type TerminalEvent, type TerminalRequest} from './protocol';

export interface SharedScreen {
  id: number;
  port: MessagePort;
  epoch: number;
  owner: boolean;
}

export function bindSharedScreen(screen: HTMLElement, term: Terminal, fit: FitAddon, view: SharedScreen) {
  let disposed = false;
  let ready = false;
  let running = true;
  let lastSize = '';
  let queue = Promise.resolve();
  const post = (message: TerminalRequest) => view.port.postMessage(message);
  const visible = () => screen.clientWidth > 0 && screen.clientHeight > 0 && !screen.closest('.terminal-frame[hidden]');
  const online = () => running && ready && view.owner && !disposed;
  term.options.disableStdin = true;
  useWorkerDeviceReplies(term);

  function resize() {
    if (!visible() || disposed) return;
    if (!view.owner) {
      // Scale the full PTY grid around its top-left corner, including its cursor.
      const grid = screen.querySelector<HTMLElement>('.xterm-screen');
      if (grid && grid.offsetWidth && grid.offsetHeight) {
        const scale = Math.min(1,screen.clientWidth/grid.offsetWidth,screen.clientHeight/grid.offsetHeight);
        term.element!.style.transform = scale < 1 ? 'scale('+scale+')' : '';
      }
      return;
    }
    if (!online()) return;
    const dims = fit.proposeDimensions();
    if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return;
    const cols = Math.min(1000,dims.cols), rows = Math.min(1000,dims.rows);
    const key = cols+'x'+rows;
    if (lastSize !== key) {
      lastSize = key;
      post({type:'terminal.size',id:view.id,epoch:view.epoch,cols,rows});
    }
  }

  function send(data: Uint8Array<ArrayBuffer>) {
    if (!online()) return;
    for (let start=0; start<data.length; start+=16384) {
      post({type:'terminal.input',id:view.id,epoch:view.epoch,data:data.subarray(start,start+16384)});
    }
  }
  function updateRunning(next: boolean) {
    running = next;
    term.options.disableStdin = !online();
    term.options.cursorBlink = online();
    if (!running) term.write('\x1b[?25l');
  }
  function receive({data:frame}: MessageEvent<TerminalEvent>) {
    if (frame.type !== 'terminal.snapshot' && frame.type !== 'terminal.resize' && frame.type !== 'terminal.output') return;
    if (frame.id !== view.id) return;
    if (frame.epoch !== view.epoch) {
      post({type:'terminal.ack',id:view.id,seq:frame.seq});
      return;
    }
    queue = queue.then(async () => {
      if (disposed) return;
      if (frame.type === 'terminal.snapshot') {
        ready = false;
        term.options.disableStdin = true;
        term.reset();
      }
      if (frame.type !== 'terminal.output') term.resize(frame.cols,frame.rows);
      if (frame.type !== 'terminal.resize') {
        await new Promise<void>(done => term.write(frame.data,done));
      }
      if (disposed) return;
      if (frame.type === 'terminal.snapshot') {
        ready = true;
        updateRunning(running);
      }
      if (frame.type !== 'terminal.output') resize();
      post({type:'terminal.ack',id:view.id,seq:frame.seq});
    });
  }
  view.port.addEventListener('message',receive);
  post({type:'terminal.watch',id:view.id});
  return {visible,online,resize,send,updateRunning,
    take() {
      const dims = fit.proposeDimensions();
      post({type:'terminal.take',id:view.id,cols:dims?.cols,rows:dims?.rows});
    },
    dispose() {
      disposed = true;
      view.port.removeEventListener('message',receive);
      post({type:'terminal.unwatch',id:view.id});
    },
  };
}
