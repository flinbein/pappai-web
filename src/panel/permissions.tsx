import { useEffect, useState } from 'react';
import { call, errorMessage, formatJSON, parseJSON } from './api';
import { Form, NoRestrictions, Submit, useMounted } from './controls';
import type { Refresh } from './workspace';

export function Permissions({ id, getVersion, setVersion, refresh }: {
  id: string;
  getVersion?: string;
  setVersion: string;
  refresh: Refresh;
}) {
  const [draft, setDraft] = useState<string>();
  const [message, setMessage] = useState('');
  const mounted = useMounted();
  useEffect(() => {
    if (!getVersion) return;
    let current = true;
    void call<{ permissions: unknown }>(id, '$.permissions.get', {}, getVersion).then(result => {
      if (current) setDraft(previous => previous ?? formatJSON(result.permissions));
    }).catch(error => { if (current) setMessage(errorMessage(error)); });
    return () => { current = false; };
  }, [id, getVersion]);
  return <>
    <h2>Edit permissions</h2>
    <Form id="edit-permissions" feedback={setMessage} submit={async () => {
      const permissions = parseJSON(draft ?? '');
      if (permissions !== null && !Array.isArray(permissions)) throw Error('Enter a JSON array of rules or null.');
      await call(id, '$.permissions.set', { permissions }, setVersion);
      if (mounted.current) {
        setMessage('Permissions saved.');
        await refresh();
      }
    }}>
      <label>Permission rules (JSON)<textarea rows={8} spellCheck={false} required value={draft ?? ''}
        onChange={event => setDraft(event.target.value)} /></label>
      <NoRestrictions onSelect={() => setDraft('null')} />
      <p><Submit disabled={!draft?.trim()}>Save permissions</Submit></p>
    </Form>
    <p role="status">{message}</p>
  </>;
}
