import { PanelConnection } from './transport';

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
  type: 'method' | 'event' | 'document';
  version: string;
  description: string;
  doc?: string;
  schema?: unknown;
}
export type Catalog = Record<string, Feature>;
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

let active: { user: string; connection: PanelConnection; onExpired: () => void } | undefined;

export function stopPanelConnection() {
  active?.connection.stop();
  active = undefined;
}

export function startPanelConnection(user: string, onExpired: () => void) {
  if (active?.user === user) {
    active.onExpired = onExpired;
    return;
  }
  stopPanelConnection();
  const connection = new PanelConnection(
    () => new WebSocket(new URL('/api/ws/web', location.href)),
    async () => (await getSession()).user === user,
    () => {
      if (active?.connection !== connection) return;
      const expired = active.onExpired;
      active = undefined;
      expired();
    },
  );
  active = { user, connection, onExpired };
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

export function getRunners() {
  return call<Runner[]>('~', '$.runners.get');
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

export const logout = () => auth('logout');
export const recover = (email: string) => auth('recover', { email });
