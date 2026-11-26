import {createContext, lazy, Suspense, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {DirectoryNode} from './api';
import type {CliAction} from '../terminal/launch-input';

const TerminalTabs = lazy(() => import('../terminal/tabs'));
type Attach = (element: HTMLElement, action?: CliAction) => () => void;
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
  const [slot, setSlot] = useState<{action?: CliAction; visible:boolean}>();
  const attach = useCallback<Attach>((element, action) => {
    element.append(host);
    setSlot({action, visible:true});
    return () => {
      host.remove();
      setSlot(previous => previous && {...previous, visible:false});
    };
  }, [host]);
  return <AttachTerminal.Provider value={attach}>{children}{slot && createPortal(
    <Suspense fallback={<p>Loading terminal…</p>}><TerminalTabs nodes={nodes} action={slot.action}
      visible={slot.visible && (slot.action ? actionVisible : shellVisible)} defaultSandbox={defaultSandbox}
      canChooseSandbox={canChooseSandbox} onOnlineChange={onOnlineChange}/></Suspense>, host
  )}</AttachTerminal.Provider>;
}

export function TerminalSlot({node, method, schema, description, doc}: Partial<CliAction>) {
  const outlet = useRef<HTMLDivElement>(null);
  const attach = useContext(AttachTerminal)!;
  useLayoutEffect(() => attach(outlet.current!, node && method ? {node, method, schema, description, doc} : undefined),
    [attach, node, method, schema, description, doc]);
  return <div className="terminal-outlet" ref={outlet}/>;
}
