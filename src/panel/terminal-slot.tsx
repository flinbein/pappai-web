import {createContext, lazy, Suspense, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {useLocation} from 'react-router';
import type {DirectoryNode} from './api';
import {activeTerminalPort} from './shared-client';
import type {TerminalEvent} from '../terminal/protocol';
import type {CliAction} from '../terminal/launch-input';

const TerminalTabs = lazy(() => import('../terminal/tabs'));
type Attach = (element: HTMLElement, entryKey: string, action?: CliAction) => () => void;
const AttachTerminal = createContext<Attach | null>(null);

export function TerminalProvider({children, nodes, shellVisible, actionVisible, defaultSandbox, canChooseSandbox, onOnlineChange}: {
  children: ReactNode;
  nodes: DirectoryNode[];
  shellVisible: boolean;
  actionVisible: boolean;
  defaultSandbox: boolean;
  canChooseSandbox: boolean;
  onOnlineChange(online: boolean): void;
}) {
  const [host] = useState(() => Object.assign(document.createElement('div'), {className:'terminal-portal'}));
  const [slot, setSlot] = useState<{action?: CliAction; entryKey: string}>();
  const entryKey = useLocation().key;
  const port = activeTerminalPort();
  useLayoutEffect(() => {
    if (!port) return;
    function onRegistry({data}: MessageEvent<TerminalEvent>) {
      if (data.type === 'terminal.registry') onOnlineChange(data.entries.some(entry => entry.state === 'online'));
    }
    port.addEventListener('message', onRegistry);
    port.postMessage({type:'terminal.list'});
    return () => port.removeEventListener('message', onRegistry);
  }, [port, onOnlineChange]);
  const attach = useCallback<Attach>((element, entryKey, action) => {
    element.append(host);
    setSlot({action, entryKey});
    return () => {
      host.remove();
      setSlot(previous => previous && {...previous, entryKey:''});
    };
  }, [host]);
  return <AttachTerminal.Provider value={attach}>{children}{slot && createPortal(
    <Suspense fallback={<p>Loading terminal…</p>}><TerminalTabs nodes={nodes} action={slot.action} entryKey={slot.entryKey === entryKey ? entryKey : undefined}
      visible={slot.entryKey === entryKey && (slot.action ? actionVisible : shellVisible)} defaultSandbox={defaultSandbox}
      canChooseSandbox={canChooseSandbox} onOnlineChange={onOnlineChange}/></Suspense>, host
  )}</AttachTerminal.Provider>;
}

export function TerminalSlot({node, method, feature}: Partial<CliAction>) {
  const outlet = useRef<HTMLDivElement>(null);
  const attach = useContext(AttachTerminal)!;
  const entryKey = useLocation().key;
  useLayoutEffect(() => attach(outlet.current!, entryKey, node && method ? {node, method, feature} : undefined),
    [attach, entryKey, node, method, feature]);
  return <div className="terminal-outlet" ref={outlet}/>;
}
