import { useContext, useEffect, useMemo, useState } from 'react';
import { call, errorMessage, formatJSON, getCatalog, statusLabel, supports } from './api';
import type { Catalog, DirectoryNode, Status } from './api';
import { Action, Form, Submit, useMounted } from './controls';
import { snapshotReader } from './refresh-snapshot';
import { usePappaiEvent } from './use-pappai-event';
import { AppManagement } from './app-management';
import { canCreate, choices, CreateNode } from './create-node';
import { FeatureLinks, Method } from './features';
import { NodeActionLink } from './node-action-link';
import { TerminalSlot } from './terminal-slot';
import { Profile } from './profile';
import { Permissions } from './permissions';
import { RunnerCatalogRevision, RunnerInstallerSlot } from './runner-installer-slot';
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

export function NodePanel({ node, nodes, action, chooseAction, refresh, reply, updateReply }: Props) {
  const [status, setStatus] = useState(node.status);
  const [catalog, setCatalog] = useState<Catalog>();
  const [error, setError] = useState('');
  const { id, type } = node;
  const runnerRevision = useContext(RunnerCatalogRevision);
  const workspaceRevision = type === 'workspace' ? runnerRevision : 0;
  const mounted = useMounted();

  useEffect(() => { setStatus(node.status); }, [node.status]);
  useEffect(() => {
    let current = true;
    void getCatalog(id).then(result => { if (current) setCatalog(result); })
      .catch(reason => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [id, workspaceRevision]);

  const hasChildren = supports(catalog, '$.children');
  const createChoices = catalog ? choices.filter(([kind]) => canCreate(kind, catalog)) : [];
  const lifecycle = supports(catalog, '$.lifecycle');
  const manageApp = supports(catalog, '$.app');
  const manageProfile = supports(catalog, '$.profile');
  const setPermissions = catalog?.['$.permissions.set'];
  const editPermissions = supports(catalog, '$.permissions') && setPermissions?.type === 'method';
  const manageRunners = supports(catalog, '$.runners') && (catalog?.['$.runners.add']?.type === 'method'
    || (catalog?.['$.runners.list']?.type === 'method' && ['$.runners.restart', '$.runners.delete'].some(key => catalog[key]?.type === 'method')));
  const readStatus = useMemo(() => snapshotReader(
    () => call<{status: Status}>(id, '$.lifecycle.get'),
    result => { if (mounted.current) setStatus(result.status); },
  ), [id, mounted]);
  function synchronizeStatus() {
    void readStatus().catch(reason => { if (mounted.current) setError(errorMessage(reason)); });
  }
  usePappaiEvent({ node: id, events: '$.lifecycle.statusChanged' }, synchronizeStatus,
    { disabled: !lifecycle, onSubscribed: synchronizeStatus, onError: synchronizeStatus });
  async function changeLifecycle(command: 'start' | 'stop') {
    await call(id, '$.lifecycle.' + command);
    if (mounted.current) await Promise.all([readStatus(), refresh()]);
  }
  const lifecycleProps = { status, changeLifecycle: lifecycle ? changeLifecycle : undefined };
  const execute = type === 'app' ? catalog?.['agent.execute'] : undefined;
  const chat = execute?.type === 'method' && execute.version === '1';
  const cliShortcuts = type === 'profile' ? Object.entries(catalog ?? {}).filter(([, feature]) => feature.type === 'cli') : [];
  const segments = decodeAction(action);
  const [section, name] = segments;
  const navigation = { nodeId: id, action: segments.map(encodeURIComponent).join('/'), chooseAction };
  const kind = createChoices.find(([value]) => value === name)?.[0];
  const contract = catalog && name && Object.hasOwn(catalog, name) ? catalog[name] : undefined;

  function renderAction() {
    if (!catalog) return error ? null : <p role="status">Loading actions…</p>;
    if (segments.length === 1) {
      if (section === 'runners' && manageRunners) return <RunnerInstallerSlot node={id} catalog={catalog} />;
      if (section === 'permissions' && editPermissions) {
        const get = catalog['$.permissions.get'];
        return <Permissions id={id} getVersion={get?.type === 'method' ? get.version : undefined}
          setVersion={setPermissions.version} refresh={refresh} />;
      }
      if (section === 'manage' && manageApp) {
        return <AppManagement id={id} refresh={refresh} feedback={setError} {...lifecycleProps} onCatalog={setCatalog} />;
      }
      if (section === 'profile' && manageProfile) {
        return <Profile id={id} nodes={nodes} {...lifecycleProps} feedback={setError}
          canImport={catalog['codex.setup']?.type === 'method' && catalog['codex.setup'].version === '1'} />;
      }
      if (section === 'chat' && chat) {
        return <Chat id={id} version={execute.version} reply={reply} updateReply={updateReply} />;
      }
    }
    if (segments.length === 2) {
      if (section === 'methods' && name && contract) {
        if (contract.type === 'cli') return <TerminalSlot node={id} method={name} feature={contract} />;
        return <Method key={name} id={id} name={name} feature={contract} refresh={refresh} />;
      }
      if (section === 'create' && kind) {
        return <CreateNode parent={node} nodes={nodes} catalog={catalog} type={kind}
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
      {lifecycle && <section aria-label="Lifecycle"><h2>Lifecycle</h2><div className="app-actions">
        <Action id="lifecycle-start" disabled={status === 'working' || status === 'stopping'}
          feedback={setError} run={() => changeLifecycle('start')}>Start</Action>
        <Action id="lifecycle-stop" className="secondary" disabled={status === 'stopped' || status === 'stopping'}
          feedback={setError} run={() => changeLifecycle('stop')}>Stop</Action>
      </div></section>}
      {(createChoices.length > 0 || chat || manageApp || manageProfile || manageRunners || editPermissions || cliShortcuts.length > 0) && <section id="actions">
        <h2>Actions</h2>
        <ul className="action-list">
          {chat && <li><NodeActionLink {...navigation} id="show-chat" path="chat">Message agent</NodeActionLink></li>}
          {manageApp && <li><NodeActionLink {...navigation} id="show-management" path="manage">Manage APP</NodeActionLink></li>}
          {manageProfile && <li><NodeActionLink {...navigation} id="show-profile" path="profile">Profile settings</NodeActionLink></li>}
          {manageRunners && <li><NodeActionLink {...navigation} id="show-runners" path="runners">Manage runners</NodeActionLink></li>}
          {editPermissions && <li><NodeActionLink {...navigation} path="permissions">Edit permissions</NodeActionLink></li>}
          {cliShortcuts.map(([method]) =>
            <li key={method}><NodeActionLink {...navigation} cliMethod={method} path={'methods/' + encodeURIComponent(method)}>{method}</NodeActionLink></li>)}
          {createChoices.map(([value, label], index) => <li key={value}>
            <NodeActionLink {...navigation} id={index === 0 ? 'new-node' : undefined} path={'create/' + value}>Create {label}</NodeActionLink>
          </li>)}
        </ul>
      </section>}
      {catalog ? <FeatureLinks {...navigation} catalog={catalog} /> : !error && <p role="status">Loading help…</p>}
      {!action && <p id="node-error" role="alert">{error}</p>}
    </section>
    {action && <section className={'action-column' + (section === 'methods' && contract?.type === 'cli' ? ' cli-action-column' : '')} aria-label="Node action">
      {renderAction()}
      <p id="node-error" role="alert">{error}</p>
    </section>}
  </>;
}
