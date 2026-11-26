type InstallerRequest =
  | {type: 'installer.open' | 'installer.close'; id: number}
  | {type: 'installer.send'; id: number; data: string | ArrayBuffer | Uint8Array<ArrayBuffer>};

export class InstallerSockets {
  private sockets = new Map<number, WebSocket>();
  private port: MessagePort;
  private url: URL;

  constructor(port: MessagePort, browserSession: string) {
    this.port = port;
    this.url = new URL('/api/ws/terminal', location.href);
    this.url.searchParams.set('start', 'manual');
    this.url.searchParams.set('browserSession', browserSession);
  }

  receive(message: InstallerRequest) {
    const {id} = message;
    const existing = this.sockets.get(id);
    if (message.type === 'installer.open') {
      if (existing) return;
      let socket: WebSocket;
      try { socket = new WebSocket(this.url); }
      catch { this.port.postMessage({type: 'installer.closed', id}); return; }
      this.sockets.set(id, socket);
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => this.port.postMessage({type: 'installer.opened', id});
      socket.onmessage = ({data}) => this.port.postMessage({type: 'installer.data', id, data},
        data instanceof ArrayBuffer ? [data] : []);
      socket.onclose = () => {
        this.sockets.delete(id);
        this.port.postMessage({type: 'installer.closed', id});
      };
    } else if (message.type === 'installer.send' && existing?.readyState === WebSocket.OPEN) {
      existing.send(message.data);
    } else if (message.type === 'installer.close') {
      existing?.close();
    }
  }

  dispose() {
    for (const socket of this.sockets.values()) {
      socket.onopen = socket.onmessage = socket.onclose = null;
      socket.close();
    }
    this.sockets.clear();
  }
}
