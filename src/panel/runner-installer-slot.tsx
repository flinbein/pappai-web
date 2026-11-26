import { createContext, lazy, Suspense, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Catalog } from './api';

const RunnerInstaller = lazy(() => import('./runners'));
export interface InstallerProps { node: string; catalog: Catalog }
type Attach = (outlet: HTMLElement, props: InstallerProps) => () => void;
const Outlet = createContext<Attach | null>(null);

export function RunnerInstallerProvider({children}: {children: ReactNode}) {
  const [host] = useState(() => document.createElement('div'));
  const [props, setProps] = useState<InstallerProps>();
  const attach = useCallback<Attach>((outlet, props) => {
    outlet.append(host);
    setProps(props);
    return () => host.remove();
  }, [host]);
  // Moving the portal host leaves the form, terminal and pending registration mounted.
  return <Outlet.Provider value={attach}>{children}
    {props && createPortal(<Suspense fallback={<p>Loading installer…</p>}><RunnerInstaller {...props} /></Suspense>, host)}
  </Outlet.Provider>;
}

export function RunnerInstallerSlot({node, catalog}: InstallerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const attach = useContext(Outlet)!;
  useLayoutEffect(() => attach(ref.current!, {node, catalog}), [attach, node, catalog]);
  return <div ref={ref} />;
}
