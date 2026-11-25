import { useCallback, useEffect, useState } from 'react';
import { call, errorMessage, formatJSON, parseJSON } from './api';
import type { DirectoryNode, Status } from './api';
import { Action, field, Form, NodeOptions, Submit, useMounted } from './controls';
import type { Feedback } from './controls';

interface Props {
  id: string;
  nodes: DirectoryNode[];
  canImport: boolean;
  onStatus: (status: Status) => void;
  feedback: Feedback;
}
export function Profile({ id, nodes, canImport, onStatus, feedback }: Props) {
  const [status, setStatus] = useState<Status>();
  const [scope, setScope] = useState('');
  const [app, setApp] = useState('');
  const [result, setResult] = useState('');
  const mounted = useMounted();
  const readProfile = useCallback(async () => {
    const profile = await call<{ status: Status; scope: unknown }>(id, '$.profile.get');
    if (!mounted.current) return;
    onStatus(profile.status);
    setScope(formatJSON(profile.scope));
    setStatus(profile.status);
  }, [id, mounted, onStatus]);

  useEffect(() => {
    void readProfile().catch(error => { if (mounted.current) feedback(errorMessage(error)); });
  }, [readProfile, mounted, feedback]);
  async function manage(command: 'enable' | 'disable') {
    await call(id, '$.profile.' + command);
    if (mounted.current) await readProfile();
  }

  return <section id="profile-controls"><h2>Profile settings</h2>
    <Form id="profile-import" hidden={!canImport} feedback={setResult} submit={async form => {
      await call(id, 'codex.setup', { authFile: field(form, 'authFile') });
      setResult('Codex credentials imported.');
    }}>
      <label>Path to auth.json on the server<input id="auth-file" name="authFile" placeholder="/tmp/codex-auth.json" required /></label>
      <Submit>Import Codex credentials</Submit>
    </Form>
    <Form id="profile-scope" feedback={setResult} submit={async () => {
      const value = parseJSON(scope);
      if (!Array.isArray(value)) throw new Error('The access scope must be a JSON array.');
      if (app && !value.includes(app)) value.push(app);
      await call(id, '$.profile.scope.set', { scope: value });
      setScope(formatJSON(value));
      setApp('');
      setResult('Access scope saved.');
    }}>
      <label>Access scope (JSON)<textarea id="scope" rows={3} required spellCheck={false}
        disabled={!status} value={scope} onChange={event => setScope(event.target.value)} /></label>
      <label>Append an APP to the access scope<select id="scope-app" value={app} onChange={event => setApp(event.target.value)}>
        <NodeOptions nodes={nodes} type="app" placeholder="None" />
      </select></label>
      <Submit disabled={!status}>Save access scope</Submit>
    </Form>
    <div className="app-actions">
      <Action id="enable-profile" feedback={setResult} disabled={!status || status === 'working'} run={() => manage('enable')}>Enable profile</Action>
      <Action id="disable-profile" className="secondary" feedback={setResult} disabled={status !== 'working'} run={() => manage('disable')}>Disable profile</Action>
    </div>
    <p id="profile-result" role="status">{result}</p>
  </section>;
}
