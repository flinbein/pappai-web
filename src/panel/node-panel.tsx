import { useEffect, useState } from 'react';
import { call, errorMessage, formatJSON, getCatalog, getRunners, statusLabel } from './api';
import type { Catalog, DirectoryNode } from './api';
import { Form, Submit } from './controls';
import { AppManagement } from './app-management';
import { canCreate, choices, CreateNode } from './create-node';
import { FeatureLinks, Method } from './features';
import { NodeActionLink } from './node-action-link';
import { Profile } from './profile';
import { RunnerInstallerSlot } from './runner-installer-slot';
import type { Refresh, Reply } from './workspace';

interface ChatProps {
  id: string;
  version: string;
  reply?: Reply;
  updateReply: (reply: Reply) => void;
}
function Chat({ id, version, reply, updateReply }: ChatProps) {
  const [message, setMessage] = useState('');
  return <section id="chat"><h2>Message agent</h2>
    <Form id="send-message" feedback={() => {}} submit={async () => {
      if (!message.trim() || reply?.pending) return;
      updateReply({ pending: true, text: 'Waiting for the agent to reply…' });
      try {
        const result = await call(id, 'agent.execute', { input: message }, version);
        updateReply({ pending: false, text: typeof result === 'string' ? result : formatJSON(result) });
        setMessage(current => current === message ? '' : current);
      } catch (error) {
        updateReply({ pending: false, text: errorMessage(error) });
      }
    }}>
      <label>Message<textarea id="message" rows={3} required value={message} onChange={event => setMessage(event.target.value)} /></label>
      <Submit disabled={reply?.pending}>Send message</Submit>
    </Form>
    <pre id="reply" role="status">{reply?.text}</pre>
  </section>;
}

interface Props {
  node: DirectoryNode;
  nodes: DirectoryNode[];
  admin: boolean;
  action: string;
  chooseAction: (path: string) => void;
  refresh: Refresh;
  reply?: Reply;
  updateReply: (reply: Reply) => void;
}

function decodeAction(action: string) {
  try {
    return action.split('/').map(decodeURIComponent);
  } catch {
    return [];
  }
}

export function NodePanel({ node, nodes, admin, action, chooseAction, refresh, reply, updateReply }: Props) {
  const [status, setStatus] = useState(node.status);
  const [catalog, setCatalog] = useState<Catalog>();
  const [availableRunner, setAvailableRunner] = useState(false);
  const [error, setError] = useState('');
  const { id, type } = node;

  useEffect(() => { setStatus(node.status); }, [node.status]);
  useEffect(() => {
    let current = true;
    async function load() {
      const result = await getCatalog(id);
      if (!current) return;
      setCatalog(result);
      // The runner may accept profile setup before its method advertisement arrives.
      if (type === 'profile' && admin && result['codex.setup']?.type !== 'method') {
        const runners = await getRunners();
        if (current) setAvailableRunner(runners.some(r => r.name === 'codex' && r.available));
      }
    }
    void load().catch(reason => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [id, type, admin]);

  const hasChildren = type === 'workspace' || type === 'team';
  const createChoices = hasChildren && catalog ? choices.filter(([kind]) => canCreate(kind, catalog, admin)) : [];
  const manageApp = admin && type === 'app';
  const execute = type === 'app' ? catalog?.['agent.execute'] : undefined;
  const chat = execute?.type === 'method';
  const segments = decodeAction(action);
  const [section, name] = segments;
  const navigation = { nodeId: id, action: segments.map(encodeURIComponent).join('/'), chooseAction };
  const kind = createChoices.find(([value]) => value === name)?.[0];
  const contract = catalog && name && Object.hasOwn(catalog, name) ? catalog[name] : undefined;

  function renderAction() {
    if (segments.length === 1) {
      if (section === 'manage' && manageApp) {
        return <AppManagement id={id} refresh={refresh} feedback={setError} onStatus={setStatus} onCatalog={setCatalog} />;
      }
      if (section === 'profile' && type === 'profile') {
        return <Profile id={id} nodes={nodes} onStatus={setStatus} feedback={setError}
          canImport={catalog?.['codex.setup']?.type === 'method' || availableRunner} />;
      }
      if (section === 'chat' && chat) {
        return <Chat id={id} version={execute.version} reply={reply} updateReply={updateReply} />;
      }
    }
    if (!catalog) return error ? null : <p role="status">Loading actions…</p>;
    if (segments.length === 2) {
      if (section === 'methods' && name && contract) {
        if (type === 'workspace' && name === '$.runners.add' && contract.type === 'method') {
          return <RunnerInstallerSlot node={id} catalog={catalog} />;
        }
        return <Method key={name} id={id} name={name} feature={contract} catalog={catalog} refresh={refresh}
          chooseFeature={feature => chooseAction('methods/' + encodeURIComponent(feature))} />;
      }
      if (section === 'create' && kind) {
        return <CreateNode parent={node} nodes={nodes} admin={admin} catalog={catalog} type={kind}
          chooseType={value => chooseAction('create/' + value)} close={() => chooseAction('')} refresh={refresh} />;
      }
    }
    return <p role="status">This action is unavailable for this node.</p>;
  }

  return <>
    <section id="node-content" className="node-column" aria-labelledby="node-name">
      <div className="node-heading">
        <div><span id="node-type" className="type-label">{type.toUpperCase()}</span>
          <h1 id="node-name">{node.name}</h1><code id="node-id">{id}</code></div>
        <span id="node-status" className="status" hidden={!status} data-state={status ?? ''}>{status && statusLabel[status]}</span>
      </div>
      {hasChildren && <section id="children"><h2>Child nodes</h2>
        <p id="child-count">Visible child nodes: {nodes.filter(n => n.parentId === id).length}</p>
      </section>}
      {(createChoices.length > 0 || chat || manageApp || type === 'profile') && <section id="actions">
        <h2>Actions</h2>
        <ul className="action-list">
          {chat && <li><NodeActionLink {...navigation} id="show-chat" path="chat">Message agent</NodeActionLink></li>}
          {manageApp && <li><NodeActionLink {...navigation} id="show-management" path="manage">Manage APP</NodeActionLink></li>}
          {type === 'profile' && <li><NodeActionLink {...navigation} id="show-profile" path="profile">Profile settings</NodeActionLink></li>}
          {createChoices.map(([value, label], index) => <li key={value}>
            <NodeActionLink {...navigation} id={index === 0 ? 'new-node' : undefined} path={'create/' + value}>Create {label}</NodeActionLink>
          </li>)}
        </ul>
      </section>}
      {catalog ? <FeatureLinks {...navigation} catalog={catalog} /> : !error && <p role="status">Loading help…</p>}
      {!action && <p id="node-error" role="alert">{error}</p>}
    </section>
    {action && <section className="action-column" aria-label="Node action">
      {renderAction()}
      <p id="node-error" role="alert">{error}</p>
    </section>}
  </>;
}
