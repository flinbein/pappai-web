import type { EventFilter, PanelConnection, PappaiEvent } from './transport';

type Listener = {
  receive: (event: PappaiEvent) => void;
  ready?: () => void;
  error?: (error: Error) => void;
};

let terminalPort: MessagePort | undefined;
export const activeTerminalPort = () => terminalPort;

// Older workers request this page's unique document lock. Its pending
// clientId identifies the live worker across reloads and browser tabs.
const legacyWorkerLookup = new WeakMap<MessagePort, () => Promise<string | undefined>>();
export function legacyTerminalWorkerId(port: MessagePort) {
  return legacyWorkerLookup.get(port)?.() ?? Promise.resolve(undefined);
}

export class SharedPanelConnection implements Pick<PanelConnection, 'rpc' | 'subscribe' | 'stop'> {
  private worker: SharedWorker;
  private port: MessagePort;
  private stopped = false;
  private releaseDocumentLock?: () => void;
  private nextId = 0;
  private requests = new Map<number, {resolve(value: unknown): void; reject(error: Error): void}>();
  private subscriptions = new Map<number, Listener>();

  constructor(user: string, browserSession: string, onExpired: (reason?: string) => void) {
    const options = { type: 'module' as const, name: JSON.stringify([user, browserSession]), extendedLifetime: true };
    const url = import.meta.env.DEV ? new URL(/* @vite-ignore */ './shared-worker.ts', import.meta.url) : '/api/web-worker-v1.js';
    this.worker = new SharedWorker(url, options);
    this.port = this.worker.port;
    terminalPort = this.port;
    const ended = (reason?: string) => {
      if (this.stopped) return;
      this.stop();
      onExpired(reason);
    };
    this.worker.onerror = () => ended('The shared workspace connection failed. Reload to reconnect.');
    this.port.addEventListener('close', () => ended('The shared workspace connection closed. Reload to reconnect.'));
    this.port.onmessage = ({data}) => {
      switch (data.type) {
        case 'terminal.registry':
          this.port.postMessage({type: 'terminal.registryAck', seq: data.seq});
          break;
        case 'panel.expired': ended(); break;
        case 'panel.result': {
          const request = this.requests.get(data.id);
          if (!request) return;
          this.requests.delete(data.id);
          if (data.error !== undefined) request.reject(new Error(data.error));
          else request.resolve(data.value);
          break;
        }
        case 'panel.event': this.subscriptions.get(data.id)?.receive(data.event); break;
        case 'panel.ready': this.subscriptions.get(data.id)?.ready?.(); break;
        case 'panel.error': this.subscriptions.get(data.id)?.error?.(new Error(data.error)); break;
      }
    };
    this.port.start();
    if (navigator.locks) {
      const name = 'pappai-page-' + crypto.randomUUID();
      let identity: Promise<string | undefined> | undefined;
      const lookup = async () => {
        // The first registry can arrive before the worker queues its lock.
        for (let attempt = 0; attempt < 20 && !this.stopped; attempt++) {
          const locks = await navigator.locks.query();
          const id = locks.pending?.find(lock => lock.name === name)?.clientId;
          if (id) return 'client:' + id;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      };
      legacyWorkerLookup.set(this.port, () => identity ??= lookup().catch(() => undefined));
      // The browser releases this lock even when the renderer exits without pagehide.
      void navigator.locks.request(name, () => {
        if (this.stopped) return;
        this.port.postMessage({type: 'panel.documentLock', name});
        return new Promise<void>(resolve => { this.releaseDocumentLock = resolve; });
      }).catch(error => console.warn('Document lock unavailable.', error));
    }
  }

  rpc<T = unknown>(method: string, params: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.stopped) throw new Error('The workspace connection was interrupted.');
      const id = ++this.nextId;
      this.port.postMessage({type: 'panel.rpc', id, method, params});
      this.requests.set(id, {resolve: value => resolve(value as T), reject});
    });
  }

  subscribe(filter: EventFilter, receive: Listener['receive'], ready?: Listener['ready'], error?: Listener['error']) {
    if (this.stopped) throw new Error('The workspace connection was interrupted.');
    const id = ++this.nextId;
    this.port.postMessage({type: 'panel.subscribe', id, filter});
    this.subscriptions.set(id, {receive, ready, error});
    return () => {
      if (this.subscriptions.delete(id)) this.port.postMessage({type: 'panel.unsubscribe', id});
    };
  }

  stop(logout = false) {
    if (this.stopped) return;
    this.stopped = true;
    this.worker.onerror = null;
    const close = () => {
      this.port.close();
      this.releaseDocumentLock?.();
    };
    if (logout) {
      // Keep the document lock until the worker processes logout. Releasing it
      // immediately could detach this port before its logout message is read.
      const timeout = setTimeout(close, 5000);
      this.port.onmessage = ({data}) => {
        if (data.type !== 'panel.expired') return;
        clearTimeout(timeout);
        close();
      };
      this.port.postMessage({type: 'panel.logout'});
    } else {
      this.port.postMessage({type: 'panel.detach'});
      close();
    }
    if (terminalPort === this.port) terminalPort = undefined;
    for (const request of this.requests.values()) request.reject(new Error('The workspace connection was interrupted.'));
    this.requests.clear();
    this.subscriptions.clear();
  }
}
