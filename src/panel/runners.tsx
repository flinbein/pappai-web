import { useEffect, useState } from 'react';
import { call, errorMessage, formatJSON, getRunners, parseJSON } from './api';
import type { Runner } from './api';
import { Dialog, field, Form, Submit, useMounted } from './controls';
import type { Feedback } from './controls';

const defaultConfig = {
  codexExecutablePath: '/run/pappai/private/tools/codex/0.170.0/bin/codex',
  profilesDir: '/run/pappai/private/profiles',
  stateDir: '/run/pappai/private/state',
};

export function Runners({ feedback }: { feedback: Feedback }) {
  const [runners, setRunners] = useState<Runner[]>([]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const mounted = useMounted();
  useEffect(() => {
    void getRunners().then(setRunners).catch(err => { if (mounted.current) feedback(errorMessage(err)); });
  }, [feedback, mounted]);
  return <>
    <h1>Runners</h1>
    <ul id="runner-list">{runners.map(runner => <li key={runner.name}><strong>{runner.name}</strong>
      <span>{!runner.enabled ? 'Disabled' : runner.available ? 'Available' : 'Unavailable'}</span>
    </li>)}</ul>
    <button id="new-runner" onClick={() => { setError(''); setEditing(true); }}>Add runner</button>
    {editing && <Dialog id="runner-dialog" close={() => setEditing(false)}>
      <Form id="register-runner" feedback={setError} submit={async form => {
        const schema = field(form, 'schema');
        await call('~', '$.runners.add', {
          name: field(form, 'name'), entrypoint: field(form, 'entrypoint'), config: parseJSON(field(form, 'config')),
          ...(schema.trim() ? { settingsSchema: parseJSON(schema) } : {}),
        });
        setEditing(false);
        try {
          setRunners(await getRunners());
        } catch (err) {
          if (mounted.current) feedback(errorMessage(err));
        }
      }}>
        <h2>Register a runner</h2>
        <p>Enter the path to the installed runner’s entry point and its configuration on the server.</p>
        <label>Runner name<input id="runner-name" name="name" required defaultValue="codex" /></label>
        <label>Entry point<input id="entrypoint" name="entrypoint" required
          defaultValue="/run/pappai/private/runners/node_modules/@flinbein/pappai-runner-codex/src/index.mjs" /></label>
        <label>Configuration (JSON)<textarea id="runner-config" name="config" required rows={6} spellCheck={false} defaultValue={formatJSON(defaultConfig)} /></label>
        <details><summary>APP settings schema</summary>
          <label>JSON schema (optional)<textarea id="runner-schema" name="schema" rows={4} spellCheck={false} /></label>
        </details>
        <p id="runner-error" role="alert">{error}</p>
        <div className="app-actions"><Submit>Register</Submit>
          <button className="secondary" type="button" data-close onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </Form>
    </Dialog>}
  </>;
}
