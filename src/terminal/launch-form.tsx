import {useLayoutEffect, useMemo, useRef, useState} from 'react';
import {forbidsField, inputValidator, joinWords, pointerKey, splitWords} from './launch-input';
import type {CliAction, CliInput, Issue, TerminalStart} from './launch-input';
import {ThemeChoices, type ThemeName} from './themes';

interface Props {
  action?: CliAction;
  visible: boolean;
  theme: ThemeName;
  chooseTheme(theme: ThemeName): void;
  defaultSandbox: boolean;
  canChooseSandbox: boolean;
  start(request: TerminalStart, sandbox: boolean): void;
}

export function LaunchForm({action, visible, theme, chooseTheme, defaultSandbox, canChooseSandbox, start}: Props) {
  const [command, setCommand] = useState(action ? '' : '/bin/sh -i');
  const [structured, setStructured] = useState(false);
  const [args, setArgs] = useState<string[]>([]);
  const [env, setEnv] = useState<{key:string; value:string}[]>([]);
  const [argsTouched, setArgsTouched] = useState(false);
  const [envTouched, setEnvTouched] = useState(false);
  const [sandbox, setSandbox] = useState(defaultSandbox);
  const form = useRef<HTMLFormElement>(null);
  const validate = useMemo(() => inputValidator(action?.schema), [action?.schema]);
  const showArgs = !action || !forbidsField(action.schema, 'args');
  const showEnv = !action || !forbidsField(action.schema, 'env');
  const issues: Issue[] = [];
  let words = args;
  if (!structured) {
    try { words = splitWords(command); }
    catch (error) { issues.push({path:'#/args', message:(error as Error).message}); }
  }
  if (!action && !words[0]) issues.push({path:'#/args/0', message:'Enter a command.'});
  const variables: Record<string,string> = Object.create(null);
  env.forEach(({key, value}, index) => {
    const path = '#/env-row/' + index;
    if (!key || /[=\0]/u.test(key)) issues.push({path, message:'Enter a nonempty environment name without = or NUL.'});
    else if (Object.hasOwn(variables,key)) issues.push({path, message:'Environment names must be unique.'});
    if (value.includes('\0')) issues.push({path, message:'Environment values cannot contain NUL.'});
    variables[key] = value;
  });
  words.forEach((word, index) => {
    if (word.includes('\0')) issues.push({path:'#/args/' + index, message:'Arguments cannot contain NUL.'});
  });
  const input: CliInput = {};
  if (showArgs && (words.length || argsTouched)) input.args = words;
  if (showEnv && (env.length || envTouched)) input.env = variables;
  if (action) issues.push(...validate(input));
  function invalid(path: string) {
    return issues.some(issue => issue.path === path || issue.path.startsWith(path + '/')) || undefined;
  }
  useLayoutEffect(() => {
    if (visible && !matchMedia('(pointer: coarse)').matches) {
      form.current?.querySelector<HTMLElement>('textarea, input:not([type=checkbox]), button')?.focus({preventScroll:true});
    }
  }, [visible]);
  const label = action ? 'Arguments' : 'Command';
  return <form ref={form} onSubmit={event => {
    event.preventDefault();
    if (issues.length) return;
    start(action ? {cli:{node:action.node, method:action.method, input}} : {argv:words, env:variables}, !action && canChooseSandbox && sandbox);
  }}>
    {action && <header className="cli-launch-context"><strong>{action.method}</strong><code>{action.node}</code>
      {action.description && <p>{action.description}</p>}
      {action.doc && <details><summary>Method help</summary><p>{action.doc}</p></details>}</header>}
    {showArgs && <fieldset className="launch-fields" aria-invalid={invalid('#/args')}>
      <legend>{label}</legend>
      {!structured && <textarea id="terminal-command" name="command" aria-label={label} rows={1} value={command}
        autoComplete="off" spellCheck={false} autoCapitalize="off" aria-invalid={invalid('#/args')}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault(); form.current?.requestSubmit();
        } }} onChange={event => {setCommand(event.target.value); setArgsTouched(true);}}/>}
      {structured && <div className="launch-rows">{args.map((arg, index) => <div className="launch-row" key={index}>
        <textarea rows={1} aria-label={'Argument ' + index} value={arg} spellCheck={false} aria-invalid={invalid('#/args/' + index)}
          onChange={event => setArgs(args.map((value,i) => i === index ? event.target.value : value))}/>
        <button type="button" aria-label={'Remove argument ' + index} onClick={() => {setArgsTouched(true); setArgs(args.filter((_,i) => i !== index));}}>×</button>
      </div>)}
      <button type="button" onClick={() => {setArgsTouched(true); setArgs([...args,'']);}}>Add argument</button></div>}
      <button type="button" id="terminal-arguments-mode" aria-pressed={structured} onClick={() => {
        if (structured) setCommand(joinWords(args));
        else { try {setArgs(splitWords(command));} catch { return; } }
        setStructured(!structured);
      }}>{structured ? 'Compact input' : 'Edit as rows'}</button>
    </fieldset>}
    {showEnv && <details className="launch-environment"><summary aria-invalid={invalid('#/env') || invalid('#/env-row')}>Environment</summary>
      <div className="launch-rows">{env.map(({key, value}, index) => {
        const bad = invalid('#/env/' + pointerKey(key)) || invalid('#/env-row/' + index);
        return <div key={index} className="launch-row">
          <input placeholder="Name" aria-label={'Environment name ' + (index + 1)} value={key} aria-invalid={bad} spellCheck={false}
            onChange={event => setEnv(env.map((row,i) => i === index ? {...row,key:event.target.value} : row))}/>
          <textarea rows={1} placeholder="Value" aria-label={'Environment value ' + (index + 1)} value={value} aria-invalid={bad} spellCheck={false}
            onChange={event => setEnv(env.map((row,i) => i === index ? {...row,value:event.target.value} : row))}/>
          <button type="button" aria-label={'Remove environment row ' + (index + 1)} onClick={() => {setEnvTouched(true); setEnv(env.filter((_,i) => i !== index));}}>×</button>
        </div>;
      })}<button type="button" onClick={() => {setEnvTouched(true); setEnv([...env,{key:'',value:''}]);}}>Add variable</button></div>
    </details>}
    {!action && canChooseSandbox && <label className="terminal-sandbox-choice">
      <input id="terminal-sandbox" type="checkbox" checked={sandbox} onChange={event => setSandbox(event.target.checked)}/>Run in sandbox
    </label>}
    <fieldset className="launch-themes"><legend>Theme</legend><ThemeChoices value={theme} choose={chooseTheme}/></fieldset>
    {issues.length > 0 && <ul className="launch-issues" role="status">{issues.map((issue,i) => <li key={i}>{issue.message}</li>)}</ul>}
    <button id="start-terminal" type="submit" disabled={issues.length > 0}>Start</button>
  </form>;
}
