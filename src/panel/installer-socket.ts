let nextInstallerId = 0;

// Installer sessions live only while the initiating page owns their port.
export function openInstallerSocket(port: MessagePort) {
  const id = ++nextInstallerId;
  let state: number = WebSocket.CONNECTING;
  const socket = {
    binaryType: 'arraybuffer' as BinaryType,
    get readyState() { return state; },
    onopen: null as (() => void) | null,
    onclose: null as (() => void) | null,
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as (() => void) | null,
    send(data: string | ArrayBuffer | Uint8Array<ArrayBuffer>) {
      if (state === WebSocket.CONNECTING) throw new DOMException('Socket is connecting.', 'InvalidStateError');
      if (state === WebSocket.OPEN) port.postMessage({type: 'installer.send', id, data});
    },
    close() {
      if (state >= WebSocket.CLOSING) return;
      state = WebSocket.CLOSING;
      port.postMessage({type: 'installer.close', id});
      finish();
    },
  };
  function finish() {
    if (state === WebSocket.CLOSED) return;
    state = WebSocket.CLOSED;
    port.removeEventListener('message', receive);
    port.removeEventListener('close', finish);
    socket.onclose?.();
  }
  function receive({data}: MessageEvent) {
    if (data.type === 'panel.expired') return finish();
    if (data.id !== id) return;
    switch (data.type) {
      case 'installer.opened': state = WebSocket.OPEN; socket.onopen?.(); break;
      case 'installer.data': socket.onmessage?.(new MessageEvent('message', {data: data.data})); break;
      case 'installer.closed': finish(); break;
    }
  }
  port.addEventListener('message', receive);
  port.addEventListener('close', finish);
  port.postMessage({type: 'installer.open', id});
  return socket;
}
