import { Link, useLocation, useMatch, useNavigate } from 'react-router';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { errorMessage, formatJSON, parseJSON, rpc } from './api';
import type { DirectoryNode, Session } from './api';
import { Action, field, Form, Submit, useMounted } from './controls';
import type { Feedback } from './controls';
import { NodePanel } from './node-panel';
import { RunnerInstallerProvider } from './runner-installer-slot';
import { snapshotReader } from './refresh-snapshot';
import { TerminalProvider, TerminalSlot } from './terminal-slot';
import { usePappaiEvent } from './use-pappai-event';
import { useEntryState } from './entry-state';

type Pane = 'tree' | 'node' | 'action';
const narrowScreen = matchMedia('(max-width: 45rem)');
function subscribeWidth(notify: () => void) {
  narrowScreen.addEventListener('change', notify);
  return () => narrowScreen.removeEventListener('change', notify);
}
function nodePath(id: string) { return '/nodes/' + encodeURIComponent(id); }
function actionName(action: string) {
  const names: Record<string, string> = {
    create: 'Create', chat: 'Chat', manage: 'Manage', profile: 'Profile', runners: 'Manage runners', permissions: 'Edit permissions',
  };
  const [group, ...parts] = action.split('/');
  let name = parts.join('/');
  try { name = decodeURIComponent(name); } catch { /* Display an invalid path literally. */ }
  return group === 'create' ? 'Create ' + name.toUpperCase() : name || names[group] || group;
}
export type Refresh = (preferred?: string) => Promise<void>;
export interface Reply {
  text: string;
  pending: boolean;
}

interface TreeProps {
  nodes: DirectoryNode[];
  selected?: string;
  folded: Set<string>;
  toggle: (id: string) => void;
  choose: (id: string) => void;
}
function Tree({ nodes, selected, folded, toggle, choose }: TreeProps) {
  const children = new Map<string | null, DirectoryNode[]>();
  for (const node of nodes) {
    const branch = children.get(node.parentId);
    if (branch) branch.push(node);
    else children.set(node.parentId, [node]);
  }
  function row(node: DirectoryNode): React.ReactNode {
    const branch = children.get(node.id);
    const expanded = !folded.has(node.id);
    return <li key={node.id}>
      <div className={branch ? undefined : 'leaf'}>
        {branch && <button className="disclosure" aria-expanded={expanded}
          aria-label={(expanded ? 'Collapse ' : 'Expand ') + node.name} onClick={() => toggle(node.id)}>
          {expanded ? '▾' : '▸'}
        </button>}
        <button className="tree-node" data-node={node.id} title={node.type.toUpperCase() + ' · ' + node.id}
          aria-current={selected === node.id || undefined} onClick={() => choose(node.id)}><span aria-hidden="true" className={'node-symbol type-' + node.type} />{node.name}</button>
      </div>
      {branch && expanded && <ul>{branch.map(row)}</ul>}
    </li>;
  }
  return <><ul id="nodes" aria-label="Nodes">{children.get(null)?.map(row)}</ul>
    <p id="tree-empty" hidden={nodes.length > 0}>No nodes available.</p></>;
}

function Console({ refresh, feedback }: { refresh: Refresh; feedback: Feedback }) {
  const [output, setOutput] = useState('');
  return <>
    <h1>RPC console</h1>
    <Form id="invoke" feedback={feedback} submit={async form => {
      setOutput('');
      const result = await rpc(field(form, 'operation'), parseJSON(field(form, 'params')));
      setOutput(formatJSON(result));
      await refresh();
    }}>
      <label>Operation<select id="operation" name="operation"><option>call</option><option>help</option><option>discover</option></select></label>
      <label>Parameters (JSON)<textarea id="params" name="params" rows={8} spellCheck={false} defaultValue="{}" /></label>
      <Submit>Run</Submit>
    </Form>
    <h2>Result</h2><pre id="output" aria-live="polite">{output}</pre>
  </>;
}

export function Workspace({ session, feedback, signOut }: { session: Session; feedback: Feedback; signOut: () => Promise<void> }) {
  const [nodes, setNodes] = useState<DirectoryNode[]>([]);
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const match = useMatch('/nodes/:nodeId/*');
  const selected = match?.params.nodeId ?? (location.pathname === '/' ? nodes[0]?.id : undefined);
  const action = match ? location.pathname.split('/').slice(3).join('/').replace(/\/$/, '') : '';
  const terminalRoute = location.pathname === '/terminal';
  const requestedSandbox = new URLSearchParams(location.search).get('sandbox') === '1';
  const [live, setLive] = useState(false);
  const [view, patchView] = useEntryState();
  const narrow = useSyncExternalStore(subscribeWidth, () => narrowScreen.matches);
  const defaultPane = action ? 'action' : location.pathname === '/' ? 'tree' : 'node';
  const pane = view.pane === 'tree' || (view.pane === 'node' && location.pathname !== '/') ||
    (view.pane === 'action' && action) ? view.pane : defaultPane;
  const breadcrumbs = useRef<HTMLElement>(null);
  useEffect(() => {
    if (narrow) breadcrumbs.current?.querySelector('[aria-current="step"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
  }, [narrow, pane, location.key]);
  const showPane = (next: Pane) => patchView({pane: next});
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (menu.current) menu.current.open = false; }, [location.key]);
  const [folded, setFolded] = useState(new Set<string>());
  const [replies, setReplies] = useState<Record<string, Reply>>({});
  const directory = useRef<DirectoryNode[]>([]);
  const preferred = useRef<string | undefined>(undefined);
  const [creationNotice, setCreationNotice] = useState('');
  const mounted = useMounted();
  const selectCreated = useCallback((snapshot: DirectoryNode[]) => {
    const created = snapshot.find(node => node.id === preferred.current);
    if (!created) return false;
    preferred.current = undefined;
    setCreationNotice('');
    void navigate(nodePath(created.id));
    setFolded(previous => {
      const next = new Set(previous);
      let parent = created.parentId;
      while (parent) {
        next.delete(parent);
        parent = snapshot.find(node => node.id === parent)?.parentId ?? null;
      }
      return next;
    });
    return true;
  }, [navigate]);
  const readDirectory = useMemo(() => snapshotReader(
    () => rpc<DirectoryNode[]>('discover', {}),
    snapshot => {
      if (!mounted.current) return;
      directory.current = snapshot;
      setNodes(snapshot);
      setDirectoryLoaded(true);
      if (preferred.current && selectCreated(snapshot)) return;
      if (preferred.current) {
        preferred.current = undefined;
        setCreationNotice('The node was created but is currently unavailable in the tree.');
      }
    },
  ), [mounted, selectCreated]);
  const refresh = useCallback(async (createdId?: string) => {
    if (!createdId) return readDirectory();
    if (!mounted.current) return;
    preferred.current = createdId;
    if (selectCreated(directory.current)) return;
    try {
      await readDirectory();
    } catch (error) {
      if (mounted.current && preferred.current === createdId) {
        setCreationNotice('The node was created. Could not refresh the tree: ' + errorMessage(error));
      }
    }
  }, [readDirectory, selectCreated, mounted]);

  const synchronize = useCallback(() => {
    void readDirectory().catch(error => { if (mounted.current) feedback(errorMessage(error)); });
  }, [readDirectory, feedback, mounted]);
  usePappaiEvent({ events: ['$.node.created', '$.permissions.changed', '$.effectivePermissions.invalidated', '$.lifecycle.statusChanged'] },
    synchronize, { onSubscribed: synchronize, onError: error => {
      feedback('Could not subscribe to node tree updates: ' + errorMessage(error));
      synchronize();
    } });

  function chooseNode(id: string) {
    preferred.current = undefined;
    setCreationNotice('');
    feedback('');
    void navigate(nodePath(id));
  }
  const selectedNode = nodes.find(node => node.id === selected);
  const account = nodes.find(node => node.id === session.user)?.name || session.user;
  const consoleRoute = location.pathname === '/rpc';
  const nodeRoute = !!match || location.pathname === '/';
  const title = terminalRoute ? 'Terminal' : consoleRoute ? 'RPC console' : selectedNode?.name ?? selected;
  return <TerminalProvider nodes={nodes} defaultSandbox={requestedSandbox} canChooseSandbox={session.canChooseSandbox}
    shellVisible={terminalRoute && (!narrow || pane === 'node')} actionVisible={nodeRoute && (!narrow || pane === 'action')}
    onOnlineChange={setLive}><RunnerInstallerProvider><div id="workspace" data-pane={pane} data-action={Boolean(action && selectedNode)}>
    <nav ref={breadcrumbs} className="breadcrumbs" aria-label="Workspace panes">
      <button aria-current={pane === 'tree' ? 'step' : undefined} onClick={() => showPane('tree')}>Workspace</button>
      {title && location.pathname !== '/' && <><span aria-hidden="true">›</span><button aria-current={pane === 'node' ? 'step' : undefined}
        onClick={() => showPane('node')}>{title}{terminalRoute && live && <i className="online-dot" aria-label="Connected" />}</button></>}
      {action && <><span aria-hidden="true">›</span><button aria-current={pane === 'action' ? 'step' : undefined}
        onClick={() => showPane('action')}>{actionName(action)}</button></>}
    </nav>
    <aside className="directory" aria-label="Node tree">
      <details ref={menu} className="account-menu">
        <summary aria-label={'Account ' + account}><span className="avatar" aria-hidden="true">{account?.slice(0,1).toUpperCase()}</span>
          <strong>{account}</strong><span className="chevron" aria-hidden="true">⌄</span></summary>
        <div className="account-items">
          <Link id="nav-rpc" to="/rpc">RPC console</Link>
          <Action id="logout" feedback={feedback} run={signOut}>Sign out</Action>
        </div>
      </details>
      <div className="tree-scroll"><Tree nodes={nodes} selected={selected} folded={folded} toggle={id => setFolded(previous => {
        const next = new Set(previous);
        if (!next.delete(id)) next.add(id);
        return next;
      })} choose={chooseNode} /></div>
      {creationNotice && <p role="status">{creationNotice}</p>}
      <nav className="tools" aria-label="Tools">
        <a href="/files/" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 2h9v11H3z"/></svg>Files</a>
        <Link id="nav-terminal" to="/terminal" aria-current={terminalRoute ? 'page' : undefined}
          onClick={event => {
            if (terminalRoute && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              showPane('node');
            }
          }}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m6 9 3 3-3 3m5 0h5"/></svg>Terminal
          {live && <i className="online-dot" aria-label="Connected" />}</Link>
      </nav>
    </aside>
    {nodeRoute && (selectedNode
      ? <NodePanel key={selectedNode.id} node={selectedNode} nodes={nodes}
          action={action} chooseAction={next => void navigate(nodePath(selectedNode.id) + (next ? '/' + next : ''))}
          refresh={refresh} reply={replies[selectedNode.id]} updateReply={reply =>
            setReplies(previous => ({ ...previous, [selectedNode.id]: reply }))} />
      : <section className={pane === 'action' ? 'action-column' : 'node-column'}><p id="pick-node" role="status">{
        !directoryLoaded ? 'Loading node tree…' : selected ? 'Node unavailable.' : 'Select a node in the tree.'
      }</p></section>)}
    {consoleRoute && <section id="rpc-panel" className="node-column"><Console refresh={refresh} feedback={feedback} /></section>}
    {terminalRoute && <section className="terminal-column"><TerminalSlot/></section>}
    {!nodeRoute && !terminalRoute && !consoleRoute && <section className="node-column"><p>Page not found.</p><Link to="/">Workspace</Link></section>}
  </div></RunnerInstallerProvider></TerminalProvider>;
}
