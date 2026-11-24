import { Link, useLocation, useMatch, useNavigate } from 'react-router';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { errorMessage, formatJSON, parseJSON, rpc } from './api';
import type { DirectoryNode, Session } from './api';
import { Action, field, Form, Submit, useMounted } from './controls';
import type { Feedback } from './controls';
import { NodePanel } from './node-panel';
import { Runners } from './runners';
import { snapshotReader } from './refresh-snapshot';
import { usePappaiEvent } from './use-pappai-event';

const TerminalView = lazy(() => import('../terminal/view'));
type Pane = 'tree' | 'node' | 'action';
const narrowScreen = matchMedia('(max-width: 45rem)');
function subscribeWidth(notify: () => void) {
  narrowScreen.addEventListener('change', notify);
  return () => narrowScreen.removeEventListener('change', notify);
}
function nodePath(id: string) { return '/nodes/' + encodeURIComponent(id); }
function actionName(action: string) {
  const names: Record<string, string> = {create: 'Создать', chat: 'Чат', manage: 'Управление', profile: 'Профиль'};
  const [group, ...parts] = action.split('/');
  let name = parts.join('/');
  try { name = decodeURIComponent(name); } catch { /* Display an invalid path literally. */ }
  return group === 'create' ? 'Создать ' + name.toUpperCase() : name || names[group] || group;
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
          aria-label={(expanded ? 'Свернуть ' : 'Развернуть ') + node.name} onClick={() => toggle(node.id)}>
          {expanded ? '▾' : '▸'}
        </button>}
        <button className="tree-node" data-node={node.id} title={node.type.toUpperCase() + ' · ' + node.id}
          aria-current={selected === node.id || undefined} onClick={() => choose(node.id)}><span aria-hidden="true" className={'node-symbol type-' + node.type} />{node.name}</button>
      </div>
      {branch && expanded && <ul>{branch.map(row)}</ul>}
    </li>;
  }
  return <><ul id="nodes" aria-label="Ноды">{children.get(null)?.map(row)}</ul>
    <p id="tree-empty" hidden={nodes.length > 0}>Нет доступных нод.</p></>;
}

function Console({ refresh, feedback }: { refresh: Refresh; feedback: Feedback }) {
  const [output, setOutput] = useState('');
  return <>
    <h1>Консоль RPC</h1>
    <Form id="invoke" feedback={feedback} submit={async form => {
      setOutput('');
      const result = await rpc(field(form, 'operation'), parseJSON(field(form, 'params')));
      setOutput(formatJSON(result));
      await refresh();
    }}>
      <label>Операция<select id="operation" name="operation"><option>call</option><option>help</option><option>discover</option></select></label>
      <label>Параметры JSON<textarea id="params" name="params" rows={8} spellCheck={false} defaultValue="{}" /></label>
      <Submit>Выполнить</Submit>
    </Form>
    <h2>Результат</h2><pre id="output" aria-live="polite">{output}</pre>
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
  const [terminalMode, setTerminalMode] = useState<boolean | null>(terminalRoute ? requestedSandbox : null);
  const [terminalState, setTerminalState] = useState<'connecting' | 'online' | 'closed'>('connecting');
  const [view, setView] = useState<{key: string; pane: Pane}>();
  const narrow = useSyncExternalStore(subscribeWidth, () => narrowScreen.matches);
  const defaultPane = action ? 'action' : location.pathname === '/' ? 'tree' : 'node';
  const pane = view?.key === location.key ? view.pane : defaultPane;
  const breadcrumbs = useRef<HTMLElement>(null);
  useEffect(() => {
    if (narrow) breadcrumbs.current?.querySelector('[aria-current="step"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
  }, [narrow, pane, location.key]);
  const showPane = (next: Pane) => setView({ key: location.key, pane: next });
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (menu.current) menu.current.open = false; }, [location.key]);
  useEffect(() => {
    if (terminalRoute && terminalMode === null) {
      setTerminalMode(requestedSandbox);
      setTerminalState('connecting');
    }
  }, [terminalRoute, terminalMode, requestedSandbox]);
  function startInMode(sandbox: boolean) {
    if (terminalMode !== sandbox && (terminalMode === null || terminalState === 'closed')) {
      setTerminalMode(sandbox);
      setTerminalState('connecting');
    }
  }
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
        setCreationNotice('Нода создана, но сейчас недоступна в дереве.');
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
        setCreationNotice('Нода создана. Не удалось обновить дерево: ' + errorMessage(error));
      }
    }
  }, [readDirectory, selectCreated, mounted]);

  const synchronize = useCallback(() => {
    void readDirectory().catch(error => { if (mounted.current) feedback(errorMessage(error)); });
  }, [readDirectory, feedback, mounted]);
  usePappaiEvent({ events: ['$.node.created', '$.node.deleted', '$.node.permissions.updated', '$.app.statusChanged'] },
    synchronize, { onSubscribed: synchronize, onError: error => {
      feedback('Не удалось подписаться на изменения дерева: ' + errorMessage(error));
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
  const runners = location.pathname === '/runners';
  const consoleRoute = location.pathname === '/rpc';
  const nodeRoute = !!match || location.pathname === '/';
  const title = terminalRoute ? 'Терминал' : runners ? 'Раннеры' : consoleRoute ? 'Консоль RPC' : selectedNode?.name ?? selected;
  const terminalLink = terminalMode ? '/terminal?sandbox=1' : '/terminal';
  const showTerminal = terminalRoute && terminalMode === requestedSandbox;
  const live = terminalState === 'online';
  return <div id="workspace" data-pane={pane} data-action={Boolean(action && selectedNode)}>
    <nav ref={breadcrumbs} className="breadcrumbs" aria-label="Колонки">
      <button aria-current={pane === 'tree' ? 'step' : undefined} onClick={() => showPane('tree')}>Workspace</button>
      {title && location.pathname !== '/' && <><span aria-hidden="true">›</span><button aria-current={pane === 'node' ? 'step' : undefined}
        onClick={() => showPane('node')}>{title}{terminalRoute && live && <i className="online-dot" aria-label="Подключён" />}</button></>}
      {action && <><span aria-hidden="true">›</span><button aria-current={pane === 'action' ? 'step' : undefined}
        onClick={() => showPane('action')}>{actionName(action)}</button></>}
    </nav>
    <aside className="directory" aria-labelledby="tree-title">
      <details ref={menu} className="account-menu">
        <summary aria-label={'Аккаунт ' + account}><span className="avatar" aria-hidden="true">{account?.slice(0,1).toUpperCase()}</span>
          <strong>{account}</strong><span className="chevron" aria-hidden="true">⌄</span></summary>
        <div className="account-items">
          {session.canManageApps && <Link id="nav-runners" to="/runners">Раннеры</Link>}
          <Link id="nav-rpc" to="/rpc">Консоль RPC</Link>
          {session.canChooseSandbox && (terminalState === 'closed' || terminalMode === null) &&
            <Link id="isolated-terminal" to="/terminal?sandbox=1" onClick={() => startInMode(true)}>Открыть в песочнице</Link>}
          {session.canChooseSandbox && terminalMode === true && terminalState === 'closed' &&
            <Link to="/terminal" onClick={() => startInMode(false)}>Открыть без песочницы</Link>}
          <Action id="logout" feedback={feedback} run={signOut}>Выйти</Action>
        </div>
      </details>
      <div className="tree-heading"><h2 id="tree-title">Дерево нод</h2>
        <Action id="refresh" className="icon" aria-label="Обновить дерево" title="Обновить дерево" run={refresh} feedback={feedback}>↻</Action>
      </div>
      <div className="tree-scroll"><Tree nodes={nodes} selected={selected} folded={folded} toggle={id => setFolded(previous => {
        const next = new Set(previous);
        if (!next.delete(id)) next.add(id);
        return next;
      })} choose={chooseNode} /></div>
      {creationNotice && <p role="status">{creationNotice}</p>}
      <nav className="tools" aria-label="Инструменты">
        <a href="/files/" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 2h9v11H3z"/></svg>Файлы</a>
        <Link id="nav-terminal" to={terminalLink} aria-current={terminalRoute ? 'page' : undefined}
          onClick={() => showPane('node')}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m6 9 3 3-3 3m5 0h5"/></svg>Терминал
          {live && <i className="online-dot" aria-label="Подключён" />}</Link>
      </nav>
    </aside>
    {nodeRoute && (selectedNode
      ? <NodePanel key={selectedNode.id} node={selectedNode} nodes={nodes} admin={session.canManageApps}
          action={action} chooseAction={next => void navigate(nodePath(selectedNode.id) + (next ? '/' + next : ''))}
          refresh={refresh} reply={replies[selectedNode.id]} updateReply={reply =>
            setReplies(previous => ({ ...previous, [selectedNode.id]: reply }))} />
      : <section className={pane === 'action' ? 'action-column' : 'node-column'}><p id="pick-node" role="status">{
        !directoryLoaded ? 'Загрузка дерева…' : selected ? 'Нода недоступна.' : 'Выберите ноду в дереве.'
      }</p></section>)}
    {runners && <section id="runner-panel" className="node-column">{session.canManageApps
      ? <Runners feedback={feedback} /> : <p>Нет доступа.</p>}</section>}
    {consoleRoute && <section id="rpc-panel" className="node-column"><Console refresh={refresh} feedback={feedback} /></section>}
    {terminalRoute && terminalMode !== null && !showTerminal && <section className="node-column">
      <h1>Терминал</h1>{terminalState === 'closed'
        ? <button onClick={() => startInMode(requestedSandbox)}>Открыть новый терминал</button>
        : <p>Во вкладке уже открыт терминал с другим режимом изоляции. Закройте его перед сменой режима.</p>}
      <Link to={terminalLink}>Перейти к текущему терминалу</Link>
    </section>}
    {terminalMode !== null && <section className="terminal-column" hidden={!showTerminal}>
      <Suspense fallback={<p>Подключение…</p>}><TerminalView key={String(terminalMode)} sandbox={terminalMode}
        visible={showTerminal && (!narrow || pane === 'node')} onStatus={setTerminalState} /></Suspense>
    </section>}
    {!nodeRoute && !terminalRoute && !runners && !consoleRoute && <section className="node-column"><p>Страница не найдена.</p><Link to="/">Workspace</Link></section>}
  </div>;
}
