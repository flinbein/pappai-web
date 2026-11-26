import { useEffect, useState } from 'react';
import { call, formatJSON, parseJSON, supports } from './api';
import type { Catalog, DirectoryNode } from './api';
import { field, Form, NodeOptions, NoRestrictions, Submit } from './controls';
import type { Refresh } from './workspace';

const codexManifest = {
  run: {
    type: 'codex',
    settings: {
      developerInstructions: "Answer the message in data.input in the user's language.",
      features: {
        'agent.execute': {
          type: 'method', description: 'Send a message to the agent', version: '1',
          schema: {
            input: { type: 'object', properties: { input: { type: 'string', minLength: 1 } }, required: ['input'], additionalProperties: false },
            output: { type: 'string' },
          },
        },
        'agent.getHistory': { type: 'method', version: '1', description: 'Read conversation history' },
        'agent.interrupt': { type: 'method', version: '1', description: 'Interrupt the active turn' },
      },
    },
  },
  executors: { mode: 'persistent', idleTimeoutMs: 300000 },
};

export const choices = [
  ['team', 'TEAM'], ['profile', 'PROFILE'], ['codex', 'APP · Codex'], ['app', 'APP · Custom manifest'], ['user', 'USER'],
] as const;
type Choice = typeof choices[number][0];

const createMethods = {
  team: '$.children.createTeam', user: '$.children.createUser', app: '$.children.createApp',
  codex: '$.children.createApp', profile: '$.children.createProfile',
} as const;

function teamRules(folder: string) {
  return [
    { node: './**', methods: true, cli: true, events: true, delivery: true, discover: true },
    { node: '.', methods: [createMethods.team, createMethods.user, createMethods.app, createMethods.profile] },
    ...(folder ? [{ write: folder }] : []),
  ];
}

function CreatePermissions({ team }: { team: boolean }) {
  const [template, setTemplate] = useState(team);
  const [folder, setFolder] = useState('');
  const [rules, setRules] = useState('[]');
  return <details><summary>Node permissions</summary>
    {team && <label>Initial permissions<select name="permissionMode" value={template ? 'template' : 'custom'}
      onChange={event => {
        const selected = event.target.value === 'template';
        if (!selected) setRules(formatJSON(teamRules(folder)));
        setTemplate(selected);
      }}>
      <option value="template">Team template</option><option value="custom">Custom rules</option>
    </select></label>}
    {template && <label>Team folder (optional)<input name="teamFolder" placeholder="/workspace/my-team"
      value={folder} onChange={event => setFolder(event.target.value)} /></label>}
    <label>Rules (JSON)<textarea id="create-permissions" name="permissions" rows={3} spellCheck={false}
      readOnly={template} value={template ? formatJSON(teamRules(folder)) : rules} onChange={event => setRules(event.target.value)} /></label>
    <NoRestrictions onSelect={() => { setTemplate(false); setRules('null'); }} />
  </details>;
}

export function canCreate(type: Choice, catalog: Catalog) {
  return supports(catalog, '$.children') && catalog[createMethods[type]]?.type === 'method';
}

interface Props {
  parent: DirectoryNode;
  nodes: DirectoryNode[];
  catalog: Catalog;
  type: Choice;
  chooseType: (type: Choice) => void;
  close: () => void;
  refresh: Refresh;
}
export function CreateNode({ parent, nodes, catalog, type, chooseType, close, refresh }: Props) {
  const [error, setError] = useState('');
  const [created, setCreated] = useState(false);
  useEffect(() => {
    setError('');
    setCreated(false);
  }, [type]);
  const app = type === 'app' || type === 'codex';
  const missingProfile = type === 'codex' && !nodes.some(node => node.type === 'profile');
  return <Form id="create-node" feedback={setError} submit={async form => {
    if (created) return;
    const profile = field(form, 'profile');
    const useDefault = type === 'team' && field(form, 'permissionMode') === 'template' && !field(form, 'teamFolder');
    const data = {
      name: field(form, 'name').trim(),
      ...(!useDefault && { permissions: parseJSON(field(form, 'permissions')) }),
      ...(type === 'user' && { email: field(form, 'email') }),
      ...(type === 'codex' && { source: { manifest: codexManifest } }),
      ...(type === 'app' && { source: parseJSON(field(form, 'source')) }),
      ...(app && profile && { profile }),
    };
    const method = createMethods[type];
    const result = await call<{ id: string }>(parent.id, method, data, catalog[method].version);
    setCreated(true);
    await refresh(result.id);
  }}>
    <h2>Create node</h2><p id="parent-name">Parent: {parent.name}</p>
    <label>Node type<select id="create-type" value={type} onChange={event => chooseType(event.target.value as Choice)}>
      {choices.map(([value, label]) => <option key={value} value={value} disabled={!canCreate(value, catalog)}>{label}</option>)}
    </select></label>
    <label>Name<input id="create-name" name="name" maxLength={255} required /></label>
    <label id="email-field" hidden={type !== 'user'}>User email<input id="create-email" name="email" type="email" disabled={type !== 'user'} required={type === 'user'} /></label>
    <label id="profile-field" hidden={!app}>Authentication profile<select id="create-profile" name="profile" required={type === 'codex'}>
      <NodeOptions nodes={nodes} type="profile" placeholder="Select a profile" />
    </select></label>
    <label id="source-field" hidden={type !== 'app'}>Manifest source (JSON)<textarea id="create-source" name="source" rows={7} spellCheck={false} required={type === 'app'} /></label>
    <CreatePermissions key={parent.id + '/' + type} team={type === 'team'} />
    <p id="create-error" role="alert">{error || (missingProfile ? 'Create a PROFILE first to authenticate Codex.' : '')}</p>
    <div className="app-actions"><Submit disabled={created || missingProfile}>Create</Submit><button className="secondary" type="button" data-close onClick={close}>Cancel</button></div>
  </Form>;
}
