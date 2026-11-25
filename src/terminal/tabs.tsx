import {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {TerminalView} from './view';
import {bindTabSwipe} from './trackpad';
import {bindLaunchSwipe} from './touch';
import {TabCarousel} from './carousel';
import {flushSync} from 'react-dom';
import {keyboardInset} from './viewport';
import {rememberTheme, savedTheme, ThemeChoices, themeStyle, type ThemeName} from './themes';

export type TerminalState = 'connecting' | 'online' | 'closed' | 'nonzero' | 'failed';
type TerminalTab = {
  theme: ThemeName;
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
  return match?.[1].split('/').pop() || 'Terminal';
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
  const [launchTheme, setLaunchTheme] = useState(savedTheme);
  function chooseTheme(theme: ThemeName, id?: number) {
    setLaunchTheme(theme);
    rememberTheme(theme);
    if (id !== undefined) setTabs(items => items.map(tab => tab.id === id ? {...tab, theme} : tab));
  }
  const [sandbox, setSandbox] = useState(defaultSandbox);
  const nextId = useRef(1);
  const workspace = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const carousel = useRef<TabCarousel | null>(null);
  useLayoutEffect(() => {
    const bindings = new AbortController();
    const controller = new TabCarousel(track.current!, id => {
      const editor = document.activeElement;
      if (editor instanceof HTMLElement && editor.matches('.xterm-helper-textarea, #terminal-command') &&
          workspace.current?.contains(editor) && keyboardInset() > 60) {
        flushSync(() => setSelected(id));
        const input = id === null ? commandField.current : workspace.current.querySelector<HTMLTextAreaElement>('.terminal-frame:not([hidden]) .xterm-helper-textarea:not([disabled])');
        input?.focus({preventScroll: true});
      } else setSelected(id);
    });
    carousel.current = controller;
    bindTabSwipe(workspace.current!, controller, bindings.signal);
    bindLaunchSwipe(track.current!, controller, bindings.signal);
    return () => {
      bindings.abort();
      controller.dispose();
      carousel.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    carousel.current?.sync(visible ? [...tabs.map(tab => tab.id), null] : [], selected);
  }, [tabs, selected, visible]);
  const strip = useRef<HTMLDivElement>(null);
  const commandField = useRef<HTMLInputElement>(null);
  const online = tabs.some(tab => tab.state === 'online');
  useLayoutEffect(() => { onOnlineChange(online); }, [online, onOnlineChange]);
  useLayoutEffect(() => {
    if (!visible) return;
    strip.current?.querySelector('.terminal-tab-group[data-selected=true], #new-terminal[aria-selected=true]')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
    if (selected === null && !matchMedia('(pointer: coarse)').matches) {
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
      title: '', state: 'connecting', detail: 'starting', theme: launchTheme};
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

  return <div className="terminal-workspace" ref={workspace}>
    <div ref={strip} className="terminal-tabs" role="tablist" aria-label="Terminals" onKeyDown={moveTab}>
      {tabs.map(tab => {
        const title = tab.title || tab.program;
        const status = tab.state === 'failed' ? 'error' : tab.detail;
        return <div key={tab.id} className="terminal-tab-group" style={themeStyle(tab.theme)} data-selected={selected === tab.id}>
          <button type="button" role="tab" id={'terminal-tab-' + tab.id} className="terminal-tab"
            data-terminal={tab.id} data-state={tab.state} aria-selected={selected === tab.id}
            aria-controls={'terminal-panel-' + tab.id} title={title} onClick={() => setSelected(tab.id)}>
            <span className="terminal-tab-dot" role="img" title={status} aria-label={status}/>
            <span className="terminal-tab-title">{title}</span>
          </button>
          <button type="button" className="terminal-tab-close" data-close-terminal={tab.id}
            aria-label={'Close terminal ' + tab.id} onClick={() => remove(tab.id)}><span>×</span></button>
        </div>;
      })}
      <button id="new-terminal" type="button" role="tab" aria-controls="terminal-launch" aria-selected={selected === null}
        aria-label="New terminal" title="New terminal" onClick={() => setSelected(null)}><span>+</span></button>
    </div>
    <div className="terminal-deck">
      <div className="terminal-track" ref={track}>
        {tabs.map(tab => tab.state === 'failed'
          ? <div key={tab.id} className="terminal-frame terminal-failed-frame" style={themeStyle(tab.theme)} inert={!visible || selected !== tab.id} hidden={!visible || selected !== tab.id} id={'terminal-panel-' + tab.id}
              role="tabpanel" aria-labelledby={'terminal-tab-' + tab.id}><pre className="terminal-launch-error" role="alert">{tab.detail}</pre></div>
          : <TerminalView key={tab.id} id={tab.id} command={tab.command} sandbox={tab.sandbox}
              theme={tab.theme} onThemeChange={theme => chooseTheme(theme, tab.id)}
              connection={tab.state} visible={visible && selected === tab.id} update={update} carousel={carousel}/>)}
        <div id="terminal-launch" role="tabpanel" aria-labelledby="new-terminal" hidden={!visible || selected !== null} inert={!visible || selected !== null}>
          <form onSubmit={launch}>
            <label htmlFor="terminal-command">Command</label>
            <input ref={commandField} id="terminal-command" name="command" required value={command} autoComplete="off"
              spellCheck={false} autoCapitalize="off" onChange={event => setCommand(event.target.value)}/>
            {canChooseSandbox && <label className="terminal-sandbox-choice">
              <input id="terminal-sandbox" type="checkbox" checked={sandbox} onChange={event => setSandbox(event.target.checked)}/>
              Run in sandbox
            </label>}
            <fieldset className="launch-themes"><legend>Theme</legend>
              <ThemeChoices value={launchTheme} choose={chooseTheme}/>
            </fieldset>
            <button id="start-terminal" type="submit" disabled={!command.trim()}>Start</button>
          </form>
        </div>
      </div>
    </div>
  </div>;
}
