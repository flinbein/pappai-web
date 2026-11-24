import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call, errorMessage, formatJSON, getCatalog, parseJSON, statusLabel } from './api';
import type { Catalog, Status } from './api';
import { Action, useMounted } from './controls';
import type { Feedback } from './controls';
import type { Refresh } from './workspace';
import { snapshotReader } from './refresh-snapshot';
import { usePappaiEvent } from './use-pappai-event';

interface AppState {
  status: Status;
  lastIssue: string | null;
  manifestChanged: boolean;
}
interface Pool {
  limit: number | null;
  active: number;
  queued: number;
  restarting: boolean;
}
interface Props {
  id: string;
  onStatus: (status: Status) => void;
  onCatalog: (catalog: Catalog) => void;
  feedback: Feedback;
  refresh: Refresh;
}
export function AppManagement({ id, onStatus, onCatalog, feedback, refresh }: Props) {
  const [state, setState] = useState<AppState>();
  const [pool, setPool] = useState<Pool>();
  const [manifest, setManifest] = useState<string>();
  const [saved, setSaved] = useState('');
  const editor = useRef<HTMLTextAreaElement>(null);
  const mounted = useMounted();
  const readState = useMemo(() => snapshotReader(
    () => Promise.all([
      call<AppState>(id, '$.app.get'), call<Pool>(id, '$.app.executors.get'),
    ]),
    ([appState, executors]) => {
      if (!mounted.current) return;
      setState(appState);
      setPool(executors);
      onStatus(appState.status);
    },
  ), [id, mounted, onStatus]);
  const synchronize = useCallback(() => {
    void readState().catch(error => { if (mounted.current) feedback(errorMessage(error)); });
  }, [readState, mounted, feedback]);
  usePappaiEvent({ node: id, events: ['$.app.statusChanged', '$.app.restarted', '$.node.lastIssueUpdated'] },
    synchronize, { onSubscribed: synchronize, onError: error => {
      feedback('Не удалось подписаться на изменения APP: ' + errorMessage(error));
      synchronize();
    } });
  useEffect(() => {
    void call(id, '$.app.manifest.get')
      .then(source => { if (mounted.current) setManifest(formatJSON(source)); })
      .catch(error => { if (mounted.current) feedback(errorMessage(error)); });
  }, [id, feedback, mounted]);

  async function manage(command: 'start' | 'stop' | 'restart') {
    await call(id, '$.app.' + command);
    if (mounted.current) await Promise.all([readState(), refresh()]);
  }

  async function save() {
    const draft = manifest ?? '';
    const parsed = parseJSON(draft);
    const source = parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'run') ? { manifest: parsed } : parsed;
    await call(id, '$.app.manifest.set', { source });
    const [updated, catalog] = await Promise.all([call(id, '$.app.manifest.get'), getCatalog(id)]);
    if (!mounted.current) return;
    onCatalog(catalog);
    if (editor.current?.value === draft) {
      setManifest(formatJSON(updated));
      setSaved('Манифест сохранён');
    }
    await readState();
  }

  return <section id="app-management"><h2>Состояние APP</h2>
    <dl className="app-state">
      <div><dt>Статус</dt><dd id="app-status">{state && statusLabel[state.status]}</dd></div>
      <div><dt>Занято слотов</dt><dd id="app-active">{pool && (pool.limit === null ? pool.active : pool.active + ' / ' + pool.limit)}</dd></div>
      <div><dt>В очереди</dt><dd id="app-queued">{pool?.queued}</dd></div>
    </dl>
    <p id="app-issue" hidden={!state?.lastIssue}>{state?.lastIssue}</p>
    <div className="app-actions">
      <Action id="app-start" disabled={state?.status !== 'stopped' && state?.status !== 'error'} feedback={feedback} run={() => manage('start')}>Запустить</Action>
      <Action id="app-stop" className="secondary" disabled={state?.status !== 'working' && state?.status !== 'error'} feedback={feedback} run={() => manage('stop')}>Остановить</Action>
      <Action id="app-restart" className="secondary" disabled={state?.status !== 'working' || pool?.restarting} feedback={feedback} run={() => manage('restart')}>Перезапустить</Action>
      <Action id="app-refresh" className="secondary" feedback={feedback} run={readState}>Обновить состояние</Action>
    </div>
    <details id="manifest-details"><summary>Манифест APP</summary>
      <p id="manifest-changed" hidden={!state?.manifestChanged}>Новый манифест ожидает завершения постоянного процесса.</p>
      <label>Источник манифеста JSON<textarea id="app-manifest" ref={editor} rows={10} spellCheck={false}
        value={manifest ?? ''} disabled={manifest === undefined} onChange={event => { setManifest(event.target.value); setSaved(''); }} /></label>
      <Action id="app-save" disabled={manifest === undefined} feedback={setSaved} run={save}>Сохранить манифест</Action>
      <p id="app-feedback" role="status">{saved}</p>
    </details>
  </section>;
}
