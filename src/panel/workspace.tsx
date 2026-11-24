import { useCallback, useMemo, useRef, useState } from 'react';
import { errorMessage, formatJSON, parseJSON, rpc } from './api';
import type { DirectoryNode, Session } from './api';
import { Action, field, Form, Submit, useMounted } from './controls';
import type { Feedback } from './controls';
import { NodePanel } from './node-panel';
import { Runners } from './runners';
import { snapshotReader } from './refresh-snapshot';
import { usePappaiEvent } from './use-pappai-event';

type Page = 'node' | 'runners' | 'rpc';
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
          aria-current={selected === node.id || undefined} onClick={() => choose(node.id)}>{node.name}</button>
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

export function Workspace({ session, feedback }: { session: Session; feedback: Feedback }) {
  const [nodes, setNodes] = useState<DirectoryNode[]>([]);
  const [selected, setSelected] = useState<string>();
  const [page, setPage] = useState<Page>('node');
  const [runnerVisit, setRunnerVisit] = useState(0);
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
    setSelected(created.id);
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
  }, []);
  const readDirectory = useMemo(() => snapshotReader(
    () => rpc<DirectoryNode[]>('discover', {}),
    snapshot => {
      if (!mounted.current) return;
      directory.current = snapshot;
      setNodes(snapshot);
      if (preferred.current && selectCreated(snapshot)) return;
      if (preferred.current) {
        preferred.current = undefined;
        setCreationNotice('Нода создана, но сейчас недоступна в дереве.');
      }
      setSelected(current => snapshot.some(node => node.id === current) ? current : snapshot[0]?.id);
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

  function navigate(next: Page) {
    if (next === 'runners') setRunnerVisit(previous => previous + 1);
    setPage(next);
    feedback('');
  }

  const selectedNode = nodes.find(node => node.id === selected);
  return <div id="workspace">
    <nav className="menu" aria-label="Меню"><h2>Меню</h2>
      <button id="nav-node" aria-pressed={page === 'node'} onClick={() => navigate('node')}>Ноды</button>
      {session.canManageApps && <button id="nav-runners" aria-pressed={page === 'runners'} onClick={() => navigate('runners')}>Раннеры</button>}
      <button id="nav-rpc" aria-pressed={page === 'rpc'} onClick={() => navigate('rpc')}>Консоль RPC</button>
      <div className="links">
        <a href="/files/" target="_blank" rel="noopener">Файлы</a>
        <a href="/terminal" target="_blank" rel="noopener">Открыть терминал</a>
        {session.canChooseSandbox && <a id="isolated-terminal" href="/terminal?sandbox=1" target="_blank" rel="noopener">Открыть в песочнице</a>}
      </div>
    </nav>
    <aside className="directory" aria-labelledby="tree-title">
      <div className="tree-heading"><h2 id="tree-title">Дерево нод</h2>
        <Action id="refresh" className="icon" aria-label="Обновить дерево" title="Обновить дерево" run={refresh} feedback={feedback}>↻</Action>
      </div>
      <Tree nodes={nodes} selected={selected} folded={folded} toggle={id => setFolded(previous => {
        const next = new Set(previous);
        if (!next.delete(id)) next.add(id);
        return next;
      })} choose={id => {
        preferred.current = undefined;
        setCreationNotice('');
        navigate('node');
        setSelected(id);
      }} />
      {creationNotice && <p role="status">{creationNotice}</p>}
    </aside>
    <div className="inspector">
      <section id="node-panel" hidden={page !== 'node'}>
        {selectedNode ? <NodePanel key={selectedNode.id} node={selectedNode} nodes={nodes} admin={session.canManageApps}
          refresh={refresh} reply={replies[selectedNode.id]} updateReply={reply =>
            setReplies(previous => ({ ...previous, [selectedNode.id]: reply }))} />
          : <p id="pick-node">Выберите ноду в дереве.</p>}
      </section>
      {session.canManageApps && <section id="runner-panel" hidden={page !== 'runners'}>
        {page === 'runners' && <Runners key={runnerVisit} feedback={feedback} />}
      </section>}
      <section id="rpc-panel" hidden={page !== 'rpc'}><Console refresh={refresh} feedback={feedback} /></section>
    </div>
  </div>;
}
