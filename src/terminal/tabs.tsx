import {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {TerminalView} from './view';

export type TerminalState = 'connecting' | 'online' | 'closed' | 'nonzero' | 'failed';
type TerminalTab = {
  id: number;
  command: string;
  sandbox: boolean;
  program: string;
  title: string;
  state: TerminalState;
  detail: string;
};
export type TerminalUpdate = Partial<Pick<TerminalTab, 'program' | 'title' | 'state' | 'detail'>>;
const defaultCommand = '/bin/sh -i';

function initialProgram(command: string) {
  // Show only a simple executable until the server confirms the parsed program.
  const match = /^\s*([\w./+-]+)(?:\s|$)/u.exec(command);
  return match?.[1].split('/').pop() || 'Терминал';
}

interface Props {
  visible: boolean;
  canChooseSandbox: boolean;
  defaultSandbox: boolean;
  onOnlineChange(online: boolean): void;
}

export default function TerminalTabs({visible, canChooseSandbox, defaultSandbox, onOnlineChange}: Props) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [command, setCommand] = useState(defaultCommand);
  const [sandbox, setSandbox] = useState(defaultSandbox);
  const nextId = useRef(1);
  const strip = useRef<HTMLDivElement>(null);
  const commandField = useRef<HTMLInputElement>(null);
  const online = tabs.some(tab => tab.state === 'online');
  useLayoutEffect(() => { onOnlineChange(online); }, [online, onOnlineChange]);
  useLayoutEffect(() => {
    if (!visible) return;
    if (selected !== null) {
      strip.current?.querySelector(`[data-terminal="${selected}"]`)?.parentElement
        ?.scrollIntoView({block: 'nearest', inline: 'nearest'});
    } else if (!matchMedia('(pointer: coarse)').matches) {
      commandField.current?.focus({preventScroll: true});
    }
  }, [visible, selected]);

  const update = useCallback((id: number, change: TerminalUpdate) => {
    setTabs(previous => previous.map(tab => tab.id === id ? {...tab, ...change} : tab));
  }, []);

  function launch(event: React.FormEvent) {
    event.preventDefault();
    if (!command.trim()) return;
    const id = nextId.current++;
    const tab: TerminalTab = {id, command, sandbox: canChooseSandbox && sandbox, program: initialProgram(command),
      title: '', state: 'connecting', detail: 'starting'};
    setTabs(previous => [...previous, tab]);
    setSelected(id);
    setCommand(defaultCommand);
    setSandbox(defaultSandbox);
  }
  function remove(id: number) {
    const index = tabs.findIndex(tab => tab.id === id);
    if (selected === id) setSelected(tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null);
    setTabs(previous => previous.filter(tab => tab.id !== id));
  }
  function moveTab(event: React.KeyboardEvent) {
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return;
    const buttons = Array.from(strip.current!.querySelectorAll<HTMLButtonElement>('[role=tab]'));
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': next = (index + buttons.length - 1) % buttons.length; break;
      case 'ArrowRight': next = (index + 1) % buttons.length; break;
      case 'Home': next = 0; break;
      case 'End': next = buttons.length - 1; break;
      default: return;
    }
    event.preventDefault();
    buttons[next].focus();
  }

  return <div className="terminal-workspace">
    <div ref={strip} className="terminal-tabs" role="tablist" aria-label="Терминалы" onKeyDown={moveTab}>
      {tabs.map(tab => {
        const title = tab.title || tab.program;
        const status = tab.state === 'failed' ? 'error' : tab.detail;
        return <div key={tab.id} className="terminal-tab-group" data-selected={selected === tab.id}>
          <button type="button" role="tab" id={'terminal-tab-' + tab.id} className="terminal-tab"
            data-terminal={tab.id} data-state={tab.state} aria-selected={selected === tab.id}
            aria-controls={'terminal-panel-' + tab.id} title={title} onClick={() => setSelected(tab.id)}>
            <span className="terminal-tab-dot" role="img" title={status} aria-label={status}/>
            <span className="terminal-tab-title">{title}</span>
          </button>
          <button type="button" className="terminal-tab-close" data-close-terminal={tab.id}
            aria-label={'Закрыть терминал ' + tab.id} onClick={() => remove(tab.id)}>×</button>
        </div>;
      })}
      <button id="new-terminal" type="button" role="tab" aria-controls="terminal-launch" aria-selected={selected === null}
        aria-label="Новый терминал" title="Новый терминал" onClick={() => setSelected(null)}>+</button>
    </div>
    <div id="terminal-launch" role="tabpanel" aria-labelledby="new-terminal" hidden={selected !== null}>
      <form onSubmit={launch}>
        <label htmlFor="terminal-command">Команда</label>
        <input ref={commandField} id="terminal-command" name="command" required value={command} autoComplete="off"
          spellCheck={false} autoCapitalize="off" onChange={event => setCommand(event.target.value)}/>
        {canChooseSandbox && <label className="terminal-sandbox-choice">
          <input id="terminal-sandbox" type="checkbox" checked={sandbox} onChange={event => setSandbox(event.target.checked)}/>
          Запустить в песочнице
        </label>}
        <button id="start-terminal" type="submit" disabled={!command.trim()}>Запустить</button>
      </form>
    </div>
    {tabs.map(tab => tab.state === 'failed'
      ? <div key={tab.id} className="terminal-frame" hidden={!visible || selected !== tab.id} id={'terminal-panel-' + tab.id}
          role="tabpanel" aria-labelledby={'terminal-tab-' + tab.id}><pre className="terminal-launch-error" role="alert">{tab.detail}</pre></div>
      : <TerminalView key={tab.id} id={tab.id} command={tab.command} sandbox={tab.sandbox}
          connection={tab.state} visible={visible && selected === tab.id} update={update}/>)}
  </div>;
}
