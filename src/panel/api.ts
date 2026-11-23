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
}
export interface Session {
  user: string | null;
  canChooseSandbox: boolean;
  canManageApps: boolean;
}
export const statusLabel: Record<Status, string> = {
  working: 'Работает', stopping: 'Останавливается', stopped: 'Остановлена', error: 'Ошибка',
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
    throw new Error('Проверьте JSON: ' + errorMessage(error));
  }
}

let requestId = 0;

export async function rpc<T = unknown>(method: string, params: unknown): Promise<T> {
  const response = await fetch('/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
  });
  if (!response.ok) {
    throw new Error(response.status === 401 ? 'Сессия завершена. Войдите снова.' : 'HTTP ' + response.status);
  }
  const message = await response.json();
  if (message.error) throw new Error(message.error.message);
  return message.result;
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
  const response = await fetch('/session');
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

async function auth<T = unknown>(path: string, data: unknown = {}): Promise<T> {
  const response = await fetch('/auth/' + path, {
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
  if (!(credential instanceof PublicKeyCredential)) throw new Error('Регистрация passkey отменена.');
  await auth('register/verify', credential.toJSON());
}

export async function login() {
  const options = await auth<PublicKeyCredentialRequestOptionsJSON>('login/options');
  const credential = await navigator.credentials.get({
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
  });
  if (!(credential instanceof PublicKeyCredential)) throw new Error('Вход с passkey отменён.');
  await auth('login/verify', credential.toJSON());
}

export const logout = () => auth('logout');
export const recover = (email: string) => auth('recover', { email });
