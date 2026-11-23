import { useEffect, useState } from 'react';
import { call, errorMessage, formatJSON, getCatalog, getRunners, statusLabel } from './api';
import type { Catalog, DirectoryNode } from './api';
import { Form, Submit } from './controls';
import { AppManagement } from './app-management';
import { canCreate, CreateNode } from './create-node';
import { Features } from './features';
import { Profile } from './profile';
import type { Refresh, Reply } from './workspace';

interface ChatProps {
  id: string;
  version: string;
  reply?: Reply;
  updateReply: (reply: Reply) => void;
}
function Chat({ id, version, reply, updateReply }: ChatProps) {
  const [message, setMessage] = useState('');
  return <section id="chat"><h2>Сообщение агенту</h2>
    <Form id="send-message" feedback={() => {}} submit={async () => {
      if (!message.trim() || reply?.pending) return;
      updateReply({ pending: true, text: 'Ожидаем ответ агента…' });
      try {
        const result = await call(id, 'agent.execute', { input: message }, version);
        updateReply({ pending: false, text: typeof result === 'string' ? result : formatJSON(result) });
        setMessage(current => current === message ? '' : current);
      } catch (error) {
        updateReply({ pending: false, text: errorMessage(error) });
      }
    }}>
      <label>Сообщение<textarea id="message" rows={3} required value={message} onChange={event => setMessage(event.target.value)} /></label>
      <Submit disabled={reply?.pending}>Отправить сообщение</Submit>
    </Form>
    <pre id="reply" role="status">{reply?.text}</pre>
  </section>;
}

interface Props {
  node: DirectoryNode;
  nodes: DirectoryNode[];
  admin: boolean;
  refresh: Refresh;
  reply?: Reply;
  updateReply: (reply: Reply) => void;
}
export function NodePanel({ node, nodes, admin, refresh, reply, updateReply }: Props) {
  const [status, setStatus] = useState(node.status);
  const [{ catalog, revision }, setFeatures] = useState<{ catalog: Catalog; revision: number }>({ catalog: {}, revision: 0 });
  const [availableRunner, setAvailableRunner] = useState(false);
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  const [creating, setCreating] = useState(false);
  const { id, type } = node;

  useEffect(() => { setStatus(node.status); }, [node]);
  useEffect(() => {
    let current = true;
    async function load() {
      const catalog = await getCatalog(id);
      if (!current) return;
      setFeatures(previous => ({ catalog, revision: previous.revision + 1 }));
      // The runner may accept profile setup before its method advertisement arrives.
      if (type === 'profile' && admin && catalog['codex.setup']?.type !== 'method') {
        const runners = await getRunners();
        if (current) setAvailableRunner(runners.some(r => r.name === 'codex' && r.available));
      }
    }
    void load().catch(reason => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [id, type, admin]);

  const hasChildren = type === 'workspace' || type === 'team';
  const manageApp = admin && type === 'app';
  const execute = type === 'app' ? catalog['agent.execute'] : undefined;
  const chat = execute?.type === 'method';
  return <div id="node-content">
    <div className="node-heading">
      <div><span id="node-type" className="type-label">{type.toUpperCase()}</span><h1 id="node-name">{node.name}</h1><code id="node-id">{id}</code></div>
      <span id="node-status" className="status" hidden={!status} data-state={status ?? ''}>{status && statusLabel[status]}</span>
    </div>
    <div className="tabs" aria-label="Разделы ноды">
      <button id="show-actions" aria-pressed={!help} onClick={() => setHelp(false)}>Действия</button>
      <button id="show-help" aria-pressed={help} onClick={() => setHelp(true)}>Методы и справка</button>
    </div>
    <div id="actions" hidden={help}>
      {hasChildren && <section id="children"><h2>Дочерние ноды</h2>
        <p id="child-count">Видимых дочерних нод: {nodes.filter(n => n.parentId === id).length}</p>
        {(['team', 'profile', 'app'] as const).some(kind => canCreate(kind, catalog, admin)) &&
          <button id="new-node" onClick={() => setCreating(true)}>Создать ноду</button>}
      </section>}
      {type === 'profile' && <Profile id={id} nodes={nodes} onStatus={setStatus} feedback={setError}
        canImport={catalog['codex.setup']?.type === 'method' || availableRunner} />}
      {chat && <Chat id={id} version={execute.version} reply={reply} updateReply={updateReply} />}
      {manageApp && <AppManagement id={id} refresh={refresh} feedback={setError} onStatus={setStatus} onCatalog={updated => {
        setFeatures(previous => ({ catalog: updated, revision: previous.revision + 1 }));
      }} />}
      {!chat && !manageApp && !hasChildren && type !== 'profile' &&
        <p id="other-actions">Выберите метод во вкладке «Методы и справка».</p>}
    </div>
    <section id="feature-panel" hidden={!help}>
      <Features key={revision} id={id} catalog={catalog} refresh={refresh} />
    </section>
    <p id="node-error" role="alert">{error}</p>
    {creating && <CreateNode parent={node} nodes={nodes} admin={admin} catalog={catalog} close={() => setCreating(false)} refresh={refresh} />}
  </div>;
}
