import { PanelConnection } from './transport';
import { SharedPanelConnection } from './shared-client';

export type NodeType = 'workspace' | 'team' | 'user' | 'app' | 'profile';
export type Status = 'working' | 'stopping' | 'stopped' | 'error';
export interface DirectoryNode {
  id: string;
  parentId: string | null;
  type: NodeType;
  name: string;
  status?: Status;
}
export interface Feature {
  type: 'method' | 'cli' | 'event' | 'document';
  version: string;
  description: string;
  doc?: string;
  schema?: {input?: unknown; output?: unknown; data?: unknown};
}
export type Catalog = Record<string, Feature>;
// Specialized controls implement these versions of the controller's service documents.
const panelInterfaces = {
  '$.app': '2', '$.profile': '2', '$.runners': '2',
  '$.children': '1', '$.lifecycle': '1', '$.permissions': '1',
} as const;

export function supports(catalog: Catalog | undefined, service: keyof typeof panelInterfaces) {
  const feature = catalog?.[service];
  return feature?.type === 'document' && feature.version === panelInterfaces[service];
}
export interface Runner {
  name: string;
  available: boolean;
  enabled: boolean;
  entrypoint?: string | null;
  previousEntrypoint?: string | null;
  source?: { type: 'npm' | 'git'; spec: string; ref?: string };
}
export interface Session {
  user: string | null;
  browserSession?: string;
  canChooseSandbox: boolean;
  canManageApps: boolean;
}
export const statusLabel: Record<Status, string> = {
  working: 'Running', stopping: 'Stopping', stopped: 'Stopped', error: 'Error',
};

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function formatJSON(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? '';
}

export function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error('Invalid JSON: ' + errorMessage(error));
  }
}

let active: {
  user: string;
  browserSession?: string;
  connection: PanelConnection | SharedPanelConnection;
  onExpired: (reason?: string) => void;
} | undefined;

export function stopPanelConnection() {
  active?.connection.stop();
  active = undefined;
}

export function startPanelConnection(user: string, onExpired: (reason?: string) => void, browserSession?: string) {
  if (active?.user === user && active.browserSession === browserSession) {
    active.onExpired = onExpired;
    return;
  }
  stopPanelConnection();
  let connection: PanelConnection | SharedPanelConnection;
  const expired = (reason?: string) => {
    if (active?.connection !== connection) return;
    const notify = active.onExpired;
    active = undefined;
    notify(reason);
  };
  if (browserSession && typeof SharedWorker !== 'undefined') {
    try {
      connection = new SharedPanelConnection(user, browserSession, expired);
      active = { user, browserSession, connection, onExpired };
      return;
    } catch (error) {
      // Browser privacy settings can disable worker construction for this origin.
      console.warn('Shared workspace connection unavailable.', error);
    }
  }
  const url = new URL('/api/ws/web', location.href);
  if (browserSession) url.searchParams.set('browserSession', browserSession);
  connection = new PanelConnection(() => new WebSocket(url), async () => {
    const next = await getSession();
    return next.user === user && next.browserSession === browserSession;
  }, expired);
  active = { user, browserSession, connection, onExpired };
}

export function subscribePanelEvent(...args: Parameters<PanelConnection['subscribe']>) {
  if (!active) throw new Error('Your session has ended. Sign in again.');
  return active.connection.subscribe(...args);
}

export async function rpc<T = unknown>(method: string, params: unknown): Promise<T> {
  if (!active) throw new Error('Your session has ended. Sign in again.');
  return active.connection.rpc<T>(method, params);
}

export function call<T = unknown>(node: string, method: string, data: unknown = {}, version?: string) {
  return rpc<T>('call', { node, method, data, version });
}

export function getCatalog(node: string) {
  return rpc<Catalog>('help', { node, features: true, doc: true, schema: true });
}

export async function getSession(): Promise<Session> {
  const response = await fetch('/api/session', { cache: 'no-store' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

async function auth<T = unknown>(path: string, data: unknown = {}): Promise<T> {
  const response = await fetch('/api/auth/' + path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

export async function register(email: string, code: string) {
  const options = await auth<PublicKeyCredentialCreationOptionsJSON>('register/options', { email, code });
  const credential = await navigator.credentials.create({
    publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
  });
  if (!(credential instanceof PublicKeyCredential)) throw new Error('Passkey registration was canceled.');
  await auth('register/verify', credential.toJSON());
}

export async function login() {
  const options = await auth<PublicKeyCredentialRequestOptionsJSON>('login/options');
  const credential = await navigator.credentials.get({
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
  });
  if (!(credential instanceof PublicKeyCredential)) throw new Error('Passkey sign-in was canceled.');
  await auth('login/verify', credential.toJSON());
}

export async function logout() {
  const current = active;
  await auth('logout');
  if (current?.connection instanceof SharedPanelConnection) current.connection.stop(true);
  if (current === active) stopPanelConnection();
}
export const recover = (email: string) => auth('recover', { email });
