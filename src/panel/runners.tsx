import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import '@xterm/xterm/css/xterm.css';
import { openTerminal } from '../terminal/session';
import { call, errorMessage } from './api';
import type { Runner } from './api';
import { Form, Submit, useMounted } from './controls';
import { installerResult, nameFromEntrypoint, prepareCommand, runnerName, suggestedName } from './runner-install';
import type { SourceType } from './runner-install';
import type { InstallerProps } from './runner-installer-slot';

interface Job {
  name: string;
  method: string;
  version: string;
  command?: string;
}
type Phase = 'preparing' | 'calling' | 'prepare-failed' | 'call-failed' | 'done';

function InstallerTerminal({job, ready, failed}: {job: Job; ready: (entrypoint: string) => void; failed: (error: unknown) => void}) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const result = installerResult();
    try {
      const session = openTerminal(host.current!, 14, job.command!, false, {
        started() {}, title() {}, modifiers() {}, paste() {},
        copy() {
          const selection = session.term.getSelection();
          if (selection) void navigator.clipboard?.writeText(selection).catch(() => {});
        },
        output: result.write,
        closed(end) {
          try { ready(result.finish(end, job.name)); } catch (error) { failed(error); }
        },
      });
      session.term.options.disableStdin = true;
      return () => session.dispose();
    } catch (error) { failed(error); }
  }, [job, ready, failed]);
  return <div className="managed-terminal" role="region" aria-label="Installer terminal" ref={host} />;
}

export default function RunnerInstaller({node, catalog, changed}: InstallerProps & {changed: () => void}) {
  const mounted = useMounted();
  const [runners, setRunners] = useState<Runner[]>([]);
  const [listError, setListError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState('');
  const [type, setType] = useState<SourceType>('npm');
  const [source, setSource] = useState('');
  const [ref, setRef] = useState('');
  const [editedName, setEditedName] = useState<string>();
  const [job, setJob] = useState<Job>();
  const [path, setPath] = useState('');
  const [phase, setPhase] = useState<Phase>('preparing');
  const [message, setMessage] = useState('');
  const existing = runners.find(runner => runner.name === selected);
  const method = selected ? '$.runners.restart' : '$.runners.add';
  const list = catalog['$.runners.list'];
  const getVersion = job && 'runners.' + job.name + '.getVersion';
  const canUpdate = list?.type === 'method' && catalog['$.runners.restart']?.type === 'method';
  useEffect(() => {
    if (list?.type !== 'method') return;
    let active = true;
    setListError('');
    void call<Runner[]>(node, '$.runners.list', {}, list.version).then(value => {
      if (active) setRunners(value);
    }).catch(error => { if (active) setListError(errorMessage(error)); });
    return () => { active = false; };
  }, [node, list, revision]);

  function chooseRunner(name: string) {
    const runner = runners.find(r => r.name === name);
    setSelected(name);
    setType(runner?.source?.type ?? (name ? 'custom' : 'npm'));
    setSource(runner?.source?.spec ?? '');
    setRef(runner?.source?.ref ?? '');
    setEditedName(undefined);
    setMessage('');
  }

  const register = useCallback(async (task: Job, entrypoint: string) => {
    setPath(entrypoint);
    setPhase('calling');
    setMessage('');
    try {
      await call(node, task.method, {name: task.name, entrypoint}, task.version);
      if (!mounted.current) return;
      setPhase('done');
      changed();
      setRevision(value => value + 1);
    } catch (error) {
      if (!mounted.current) return;
      setPhase('call-failed');
      setMessage(errorMessage(error));
    }
  }, [changed, mounted, node]);
  const ready = useCallback((entrypoint: string) => {
    if (job) void register(job, entrypoint);
  }, [job, register]);
  const failed = useCallback((error: unknown) => {
    setPhase('prepare-failed');
    setMessage(errorMessage(error));
  }, []);

  function start(previousEntrypoint?: string) {
    const spec = source.trim();
    const name = selected || (type === 'custom' ? nameFromEntrypoint(spec) : (editedName ?? suggestedName(type, spec)).trim());
    if (!runnerName.test(name)) throw Error('Use 1–64 lowercase letters, digits, underscores or hyphens, starting with a letter.');
    if (name === 'process') throw Error('The built-in process runner cannot be installed or updated.');
    if (!selected && runners.some(runner => runner.name === name)) throw Error('A runner with this name is already registered.');
    const feature = catalog[method];
    if (feature?.type !== 'method') throw Error('This method is unavailable.');
    const task: Job = {name, method, version: feature.version};
    let entrypoint = previousEntrypoint;
    if (!entrypoint && type === 'custom') {
      if (nameFromEntrypoint(spec) !== name) throw Error('Use an entrypoint under the selected installation directory.');
      entrypoint = spec;
    }
    if (!entrypoint && type !== 'custom') task.command = prepareCommand(selected ? 'update' : 'add', type, name, spec, ref.trim());
    setMessage('');
    setPath('');
    setPhase('preparing');
    setJob(task);
    if (entrypoint) void register(task, entrypoint);
  }
  const status = !job ? '' : phase === 'preparing' ? 'Preparing ' + job.name + '…'
    : phase === 'calling' ? 'Calling ' + job.method + '…'
    : phase === 'done' ? job.name + (job.method === '$.runners.add' ? ' registered.' : ' restarted.')
    : phase === 'call-failed' ? 'Could not ' + (job.method === '$.runners.add' ? 'register ' : 'restart ') + job.name + '.'
    : 'Preparation failed.';
  return <section id="runner-installer">
    <h2>{selected ? 'Update runner' : 'Install runner'}</h2>
    {!job && <Form id="register-runner" feedback={setMessage} submit={async () => start()}>
      {canUpdate && <label>Installation<select id="runner-target" value={selected} onChange={e => chooseRunner(e.target.value)}>
        <option value="">New runner</option>
        {runners.filter(r => r.name !== 'process').map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
      </select></label>}
      {existing?.entrypoint && <p>Current entrypoint <code>{existing.entrypoint}</code></p>}
      <fieldset className="runner-sources"><legend>Source</legend>
        {(['npm', 'git', 'custom'] as const).map(choice => <button type="button" key={choice}
          id={'runner-source-' + choice} aria-pressed={type === choice} className={type === choice ? '' : 'secondary'}
          onClick={() => {
            if (type === choice) return;
            setType(choice); setSource(''); setEditedName(undefined); setRef(''); setMessage('');
          }}>{choice === 'custom' ? 'Custom path' : choice === 'git' ? 'Git' : 'npm'}</button>)}
      </fieldset>
      <label>{type === 'npm' ? 'Package specification' : type === 'git' ? 'HTTPS repository URL' : 'Entrypoint'}
        <input id={type === 'custom' ? 'entrypoint' : 'runner-source'} required value={source}
          placeholder={type === 'npm' ? '@scope/pappai-runner-example@latest' : type === 'git' ? 'https://example.org/pappai-runner-example.git' : '/run/pappai/private/runners/example/index.mjs'}
          onChange={e => setSource(e.target.value)} />
      </label>
      {type === 'git' && <label>Git ref (optional)<input id="runner-ref" value={ref} onChange={e => setRef(e.target.value)} /></label>}
      {!selected && type !== 'custom' && <label>Installation name<input id="runner-name" required maxLength={64}
        value={editedName ?? suggestedName(type, source)} onChange={e => setEditedName(e.target.value)} /></label>}
      <div className="app-actions">
        <Submit>{selected ? 'Update runner' : type === 'custom' ? 'Register runner' : 'Install runner'}</Submit>
        {existing?.previousEntrypoint && <button type="button" className="secondary"
          title={existing.previousEntrypoint} onClick={() => {
            try { start(existing.previousEntrypoint!); } catch (error) { setMessage(errorMessage(error)); }
          }}>Roll back</button>}
      </div>
    </Form>}
    {job?.command && <InstallerTerminal job={job} ready={ready} failed={failed} />}
    {job && <>
      <p id="runner-status" role="status">{status}</p>
      {path && <p>Entrypoint <code>{path}</code></p>}
      {phase === 'done' && getVersion && catalog[getVersion]?.type === 'method' &&
        <p><Link to={'/nodes/' + encodeURIComponent(node) + '/methods/' + encodeURIComponent(getVersion)}>Check CLI status</Link></p>}
      <div className="app-actions">
        {phase === 'call-failed' && <button onClick={() => void register(job, path)}>Retry {job.method === '$.runners.add' ? 'registration' : 'restart'}</button>}
        {['done', 'call-failed', 'prepare-failed'].includes(phase) && <button className="secondary" onClick={() => {
          setJob(undefined); setMessage('');
          if (phase === 'done') chooseRunner('');
        }}>Back to runner settings</button>}
      </div>
    </>}
    <p id="runner-error" role="alert">{message}</p>
    {listError && <p role="alert">Could not load installed runners. {listError} <button className="secondary" onClick={() => setRevision(v => v + 1)}>Reload</button></p>}
  </section>;
}
