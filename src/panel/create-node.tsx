import { useState } from 'react';
import { call, parseJSON } from './api';
import type { Catalog, DirectoryNode } from './api';
import { Dialog, field, Form, NodeOptions, Submit } from './controls';
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

const choices = [
  ['team', 'TEAM'], ['profile', 'PROFILE'], ['codex', 'APP · Codex'], ['app', 'APP · свой манифест'], ['user', 'USER'],
] as const;
type Choice = typeof choices[number][0];

export function canCreate(type: Choice, catalog: Catalog, admin: boolean) {
  if (!admin && (type === 'team' || type === 'user')) return false;
  return catalog['$.' + (type === 'codex' ? 'app' : type) + '.create']?.type === 'method';
}

interface Props {
  parent: DirectoryNode;
  nodes: DirectoryNode[];
  admin: boolean;
  catalog: Catalog;
  close: () => void;
  refresh: Refresh;
}
export function CreateNode({ parent, nodes, admin, catalog, close, refresh }: Props) {
  const [type, setType] = useState<Choice>(() => choices.find(([value]) => canCreate(value, catalog, admin))![0]);
  const [error, setError] = useState('');
  const app = type === 'app' || type === 'codex';
  const missingProfile = type === 'codex' && !nodes.some(node => node.type === 'profile');
  return <Dialog id="create-dialog" close={close}>
    <Form id="create-node" feedback={setError} submit={async form => {
      const profile = field(form, 'profile');
      const data = {
        name: field(form, 'name').trim(),
        permissions: parseJSON(field(form, 'permissions')),
        ...(type === 'user' && { email: field(form, 'email') }),
        ...(type === 'codex' && { source: { manifest: codexManifest } }),
        ...(type === 'app' && { source: parseJSON(field(form, 'source')) }),
        ...(app && profile && { profile }),
      };
      const created = await call<{ id: string }>(parent.id, '$.' + (type === 'codex' ? 'app' : type) + '.create', data);
      await refresh(created.id);
      close();
    }}>
      <h2>Создать ноду</h2><p id="parent-name">Родитель: {parent.name}</p>
      <label>Тип ноды<select id="create-type" value={type} onChange={event => { setType(event.target.value as Choice); setError(''); }}>
        {choices.map(([value, label]) => <option key={value} value={value} disabled={!canCreate(value, catalog, admin)}>{label}</option>)}
      </select></label>
      <label>Название<input id="create-name" name="name" maxLength={255} required /></label>
      <label id="email-field" hidden={type !== 'user'}>Email пользователя<input id="create-email" name="email" type="email" disabled={type !== 'user'} required={type === 'user'} /></label>
      <label id="profile-field" hidden={!app}>Профиль авторизации<select id="create-profile" name="profile" required={type === 'codex'}>
        <NodeOptions nodes={nodes} type="profile" placeholder="Выберите профиль" />
      </select></label>
      <label id="source-field" hidden={type !== 'app'}>Источник манифеста (JSON)<textarea id="create-source" name="source" rows={7} spellCheck={false} required={type === 'app'} /></label>
      <details><summary>Права ноды</summary><label>Правила (JSON)<textarea id="create-permissions" name="permissions" rows={3} spellCheck={false} defaultValue="[]" /></label></details>
      <p id="create-error" role="alert">{error || (missingProfile ? 'Сначала создайте PROFILE для авторизации Codex.' : '')}</p>
      <div className="app-actions"><Submit>Создать</Submit><button className="secondary" type="button" data-close onClick={close}>Отмена</button></div>
    </Form>
  </Dialog>;
}
