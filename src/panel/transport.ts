export interface EventFilter {
  node?: string | boolean | (string | boolean)[];
  events?: true | string | string[];
}

export interface PappaiEvent {
  from: string;
  event: string;
  data: unknown;
  subscriptionIds: string[];
}

type Registration = {
  filter: EventFilter;
  receive: (event: PappaiEvent) => void;
  ready?: () => void;
  error?: (error: Error) => void;
  addId?: number;
  active: boolean;
};

type Request = {
  body?: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const disconnected = () => new Error('Соединение с workspace прервано.');

export class PanelConnection {
  private openSocket: () => WebSocket;
  private checkSession: () => Promise<boolean>;
  private onExpired: () => void;
  private retryMs: number;
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private nextId = 0;
  private requests = new Map<number, Request>();
  private listeners = new Map<string, Registration>();

  constructor(openSocket: () => WebSocket, checkSession: () => Promise<boolean>, onExpired: () => void, retryMs = 1000) {
    this.openSocket = openSocket;
    this.checkSession = checkSession;
    this.onExpired = onExpired;
    this.retryMs = retryMs;
    this.connect();
  }

  private connect() {
    let socket: WebSocket;
    try {
      socket = this.openSocket();
    } catch {
      this.retry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      for (const request of this.requests.values()) {
        if (request.body !== undefined) this.send(socket, request);
      }
    };
    socket.onmessage = ({ data }) => {
      if (this.socket === socket && typeof data === 'string') this.message(data);
    };
    socket.onclose = ({ code }) => {
      if (this.socket !== socket) return;
      this.disconnect();
      if (code === 4401) this.expire();
      else this.retry();
    };
    for (const [id, listener] of this.listeners) this.add(id, listener);
  }

  private retry() {
    this.timer = setTimeout(async () => {
      try {
        const sameUser = await this.checkSession();
        if (this.stopped) return;
        if (sameUser) this.connect();
        else this.expire();
      } catch {
        if (!this.stopped) this.retry();
      }
    }, this.retryMs);
  }

  private expire() {
    this.stop();
    this.onExpired();
  }

  private disconnect() {
    this.socket = undefined;
    for (const listener of this.listeners.values()) {
      listener.active = false;
      listener.addId = undefined;
    }
    for (const request of this.requests.values()) request.reject(disconnected());
    this.requests.clear();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    const socket = this.socket;
    this.disconnect();
    this.listeners.clear();
    socket?.close();
  }

  private message(text: string) {
    let message;
    try { message = JSON.parse(text); } catch { return; }
    if (message?.jsonrpc !== '2.0') return;
    if (message.method === 'event') {
      const event = message.params;
      if (typeof event?.from !== 'string' || typeof event.event !== 'string' || !Array.isArray(event.subscriptionIds)) return;
      for (const id of new Set<string>(event.subscriptionIds)) {
        const listener = this.listeners.get(id);
        if (listener?.active) {
          try { listener.receive(event); } catch (error) { console.error(error); }
        }
      }
      return;
    }
    const request = this.requests.get(message.id);
    if (!request) return;
    this.requests.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  }

  private send(socket: WebSocket, request: Request) {
    try {
      socket.send(request.body!);
      request.body = undefined;
    } catch {
      this.disconnect();
      socket.close();
      this.retry();
    }
  }

  private request(method: string, params: unknown, resolve: Request['resolve'], reject: Request['reject']) {
    const id = ++this.nextId;
    const socket = this.socket;
    if (!socket || socket.readyState > 1) {
      reject(disconnected());
      return id;
    }
    let body: string;
    try {
      body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    } catch (error) {
      reject(new Error(String(error)));
      return id;
    }
    const request = { body, resolve, reject };
    this.requests.set(id, request);
    if (socket.readyState === 1) this.send(socket, request);
    return id;
  }

  rpc<T = unknown>(method: string, params: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      this.request(method, params, value => resolve(value as T), reject);
    });
  }

  private add(id: string, listener: Registration) {
    const socket = this.socket;
    if (!socket) return;
    // The controller can emit an event before the add acknowledgement arrives.
    listener.active = true;
    listener.addId = this.request('subscriptions.add', { subscriptions: [{ ...listener.filter, id }] }, () => {
      if (this.listeners.get(id) === listener) listener.ready?.();
    }, error => {
      if (this.socket === socket && this.listeners.get(id) === listener) {
        listener.active = false;
        listener.error?.(error);
      }
    });
  }

  subscribe(filter: EventFilter, receive: Registration['receive'], ready?: Registration['ready'], error?: Registration['error']) {
    if (this.stopped) throw disconnected();
    const id = 'panel-' + ++this.nextId;
    const listener: Registration = { filter, receive, ready, error, active: false };
    this.listeners.set(id, listener);
    this.add(id, listener);
    return () => {
      if (!this.listeners.delete(id) || !listener.active) return;
      if (listener.addId !== undefined && this.requests.get(listener.addId)?.body !== undefined) {
        this.requests.delete(listener.addId);
      } else {
        void this.rpc('subscriptions.delete', { ids: [id] }).catch(() => {});
      }
    };
  }
}
