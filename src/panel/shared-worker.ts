import { PanelConnection, type EventFilter } from './transport';
import { TerminalHub } from '../terminal/hub';
import type { TerminalRequest } from '../terminal/protocol';
import { InstallerSockets } from './installer-hub';

type PanelRequest =
  | {type: 'panel.detach' | 'panel.logout'}
  | {type: 'panel.documentLock'; name: string}
  | {type: 'panel.rpc'; id: number; method: string; params: unknown}
  | {type: 'panel.subscribe'; id: number; filter: EventFilter}
  | {type: 'panel.unsubscribe'; id: number};
type InstallerRequest = Parameters<InstallerSockets['receive']>[0];
type Request = PanelRequest | TerminalRequest | InstallerRequest;
type Client = {
  port: MessagePort;
  pending?: Request[];
  lifetime: AbortController;
  subscriptions: Map<number, () => void>;
  installers: InstallerSockets;
};

const scope = globalThis as unknown as {
  name: string;
  onconnect: (event: MessageEvent) => void;
  close(): void;
};
const [user, browserSession]: [string, string] = JSON.parse(scope.name);
const clients = new Set<Client>();
const terminals = new TerminalHub(browserSession);
let panel: PanelConnection | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
let stopped = false;

async function checkSession(signal?: AbortSignal) {
  const response = await fetch('/api/session', {cache: 'no-store', credentials: 'same-origin', signal});
  if (!response.ok) throw Error('HTTP ' + response.status);
  const session = await response.json();
  return session.user === user && session.browserSession === browserSession;
}

function connectPanel() {
  const url = new URL('/api/ws/web', location.href);
  url.searchParams.set('browserSession', browserSession);
  return new PanelConnection(() => new WebSocket(url), checkSession, () => shutdown(true));
}

function detach(client: Client) {
  if (!clients.delete(client)) return;
  client.lifetime.abort();
  for (const unsubscribe of client.subscriptions.values()) unsubscribe();
  client.subscriptions.clear();
  client.installers.dispose();
  if (!client.pending) terminals.detach(client.port);
  client.pending = undefined;
  client.port.onmessage = null;
  client.port.close();
  if (!clients.size && !stopped) idle = setTimeout(() => shutdown(false), 30_000);
}

function shutdown(expired: boolean) {
  if (stopped) return;
  stopped = true;
  clearTimeout(idle);
  panel?.stop();
  for (const client of clients) {
    if (expired) client.port.postMessage({type: 'panel.expired'});
    detach(client);
  }
  terminals.dispose();
  scope.close();
}

function dispatch(client: Client, message: Request) {
  const {port, subscriptions} = client;
  switch (message.type) {
    case 'panel.rpc': {
      const {id, method, params} = message;
      void panel!.rpc(method, params, client.lifetime.signal).then(
        value => { if (clients.has(client)) port.postMessage({type: 'panel.result', id, value}); },
        error => { if (clients.has(client)) port.postMessage({type: 'panel.result', id, error: String(error.message)}); },
      );
      break;
    }
    case 'panel.subscribe': {
      const {id, filter} = message;
      subscriptions.get(id)?.();
      subscriptions.set(id, panel!.subscribe(filter,
        event => port.postMessage({type: 'panel.event', id, event}),
        () => port.postMessage({type: 'panel.ready', id}),
        error => port.postMessage({type: 'panel.error', id, error: error.message}),
      ));
      break;
    }
    case 'panel.unsubscribe':
      subscriptions.get(message.id)?.();
      subscriptions.delete(message.id);
      break;
    default:
      if (message.type.startsWith('terminal.')) terminals.receive(port, message as TerminalRequest);
      else if (message.type.startsWith('installer.')) client.installers.receive(message as InstallerRequest);
  }
}

async function attach(client: Client) {
  try {
    const sameSession = await checkSession(client.lifetime.signal);
    if (!clients.has(client)) return;
    if (!sameSession) return shutdown(true);
  } catch {
    if (clients.has(client)) setTimeout(() => { if (clients.has(client)) void attach(client); }, 1000);
    return;
  }
  panel ??= connectPanel();
  const pending = client.pending!;
  client.pending = undefined;
  terminals.attach(client.port);
  for (const message of pending) dispatch(client, message);
}

scope.onconnect = ({ports: [port]}) => {
  if (stopped) { port.postMessage({type: 'panel.expired'}); port.close(); return; }
  clearTimeout(idle);
  const client: Client = {
    port, pending: [], lifetime: new AbortController(), subscriptions: new Map(),
    installers: new InstallerSockets(port, browserSession),
  };
  clients.add(client);
  port.onmessage = ({data}: MessageEvent<Request>) => {
    if (data.type === 'panel.detach') detach(client);
    else if (data.type === 'panel.logout') shutdown(true);
    else if (data.type === 'panel.documentLock' && navigator.locks) {
      void navigator.locks.request(data.name, {signal: client.lifetime.signal}, () => detach(client))
        .catch(error => { if (!client.lifetime.signal.aborted) console.warn('Document lock unavailable.', error); });
    }
    else if (client.pending) client.pending.push(data);
    else dispatch(client, data);
  };
  port.addEventListener('close', () => detach(client), {once: true});
  port.start();
  void attach(client);
};
