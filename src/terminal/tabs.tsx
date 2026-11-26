import {type CSSProperties, useCallback, useLayoutEffect, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {TerminalView} from './view';
import {bindTabSwipe} from './trackpad';
import {bindLaunchSwipe} from './touch';
import {TabCarousel} from './carousel';
import {keyboardInset} from './viewport';
import {rememberTheme, savedTheme, themeStyle, type ThemeName} from './themes';
import {LaunchForm} from './launch-form';
import type {DirectoryNode} from '../panel/api';
import type {CliAction, TerminalStart} from './launch-input';

export type TerminalState = 'connecting' | 'online' | 'closed' | 'nonzero' | 'failed';
type TerminalTab = {
  theme: ThemeName;
  id: number;
  command: TerminalStart;
  group?: string;
  nodeName?: string;
  sandbox: boolean;
  program: string;
  title: string;
  state: TerminalState;
  detail: string;
};
export type TerminalUpdate = Partial<Pick<TerminalTab, 'program' | 'title' | 'state' | 'detail'>>;
const shell = '';
function groupId(action: CliAction) { return JSON.stringify([action.node, action.method]); }
function groupStyle(id: string): CSSProperties {
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return {'--group-color': `hsl(${hash % 360} 68% 74%)`} as CSSProperties;
}
function live(tab: TerminalTab) { return tab.state === 'online' || tab.state === 'connecting'; }

function groupStatus(tabs: TerminalTab[]): TerminalState {
  for (const state of ['online', 'connecting', 'failed', 'nonzero'] as const) {
    if (tabs.some(tab => tab.state === state)) return state;
  }
  return 'closed';
}

interface Props {
  nodes: DirectoryNode[];
  action?: CliAction;
  visible: boolean;
  canChooseSandbox: boolean;
  defaultSandbox: boolean;
  onOnlineChange(online: boolean): void;
}

export default function TerminalTabs({nodes, action, visible, canChooseSandbox, defaultSandbox, onOnlineChange}: Props) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [selections, setSelections] = useState<Record<string, number | null>>({});
  const [expanded, setExpanded] = useState<string>();
  const [launchTheme, setLaunchTheme] = useState(savedTheme);
  const [formVersion, setFormVersion] = useState(0);
  const scope = action ? groupId(action) : shell;
  const selected = selections[scope] ?? null;
  const groupTabs = new Map<string, TerminalTab[]>();
  for (const tab of tabs) {
    if (!tab.group) continue;
    const group = groupTabs.get(tab.group);
    if (group) group.push(tab);
    else groupTabs.set(tab.group, [tab]);
  }
  const groupsShown = new Set<string>();
  const sections = tabs.filter(tab => {
    if (action) return tab.group === scope;
    if (!tab.group) return true;
    if (groupsShown.has(tab.group)) return false;
    groupsShown.add(tab.group);
    return true;
  });
  const slides = sections.flatMap(tab => {
    if (action || !tab.group) return [tab.id];
    if (expanded === tab.group) return groupTabs.get(tab.group)!.map(item => item.id);
    return [];
  });

  function chooseTheme(theme: ThemeName, id?: number) {
    setLaunchTheme(theme);
    rememberTheme(theme);
    if (id !== undefined) setTabs(items => items.map(tab => tab.id === id ? {...tab, theme} : tab));
  }
  const nextId = useRef(1);
  const workspace = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const carousel = useRef<TabCarousel | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  function select(id: number | null, group?: string) {
    setSelections(previous => {
      const next = {...previous,[scope]:id};
      if (id !== null) {
        next[shell] = id;
        if (group) next[group] = id;
      }
      return next;
    });
    if (group) setExpanded(group);
  }
  const fromSwipe = useRef<(id: number | null) => void>(() => {});
  useLayoutEffect(() => {
    fromSwipe.current = id => {
      const editor = document.activeElement;
      const group = tabs.find(tab => tab.id === id)?.group;
      if (editor instanceof HTMLElement && editor.matches('.xterm-helper-textarea, #terminal-command') &&
          workspace.current?.contains(editor) && keyboardInset() > 60) {
        flushSync(() => select(id, group));
        const input = workspace.current.querySelector<HTMLElement>(id === null ? '#terminal-command' : '.terminal-frame:not([hidden]) .xterm-helper-textarea:not([disabled])');
        input?.focus({preventScroll: true});
      } else select(id, group);
    };
  });
  useLayoutEffect(() => {
    const bindings = new AbortController();
    const controller = new TabCarousel(track.current!, id => fromSwipe.current(id));
    carousel.current = controller;
    bindTabSwipe(workspace.current!, controller, bindings.signal);
    bindLaunchSwipe(track.current!, controller, bindings.signal);
    return () => { bindings.abort(); controller.dispose(); carousel.current = null; };
  }, []);
  useLayoutEffect(() => { carousel.current?.sync(visible ? [...slides, null] : [], selected); });
  const online = tabs.some(tab => tab.state === 'online');
  useLayoutEffect(() => { onOnlineChange(online); }, [online, onOnlineChange]);
  useLayoutEffect(() => {
    if (visible) strip.current?.querySelector('.terminal-tab-group[data-selected=true], #new-terminal[aria-selected=true]')?.scrollIntoView({block:'nearest', inline:'nearest'});
  }, [visible, selected, scope, expanded]);

  const update = useCallback((id: number, change: TerminalUpdate) => {
    setTabs(previous => previous.map(tab => tab.id === id ? {...tab, ...change} : tab));
  }, []);

  function launch(command: TerminalStart, sandbox: boolean) {
    const id = nextId.current++;
    const group = 'cli' in command ? groupId(command.cli) : undefined;
    const program = 'cli' in command ? command.cli.method : command.argv[0].split('/').pop() || command.argv[0];
    const nodeName = 'cli' in command ? nodes.find(node => node.id === command.cli.node)?.name : undefined;
    setTabs(previous => [...previous, {id, command, group, nodeName, sandbox, program, title:'', state:'connecting', detail:'starting', theme:launchTheme}]);
    select(id, group);
    setFormVersion(value => value + 1);
  }
  function remove(items: TerminalTab[], message: string) {
    if (items.some(live) && !window.confirm(message)) return;
    const ids = new Set(items.map(item => item.id));
    const remaining = tabs.filter(item => !ids.has(item.id));
    setSelections(previous => Object.fromEntries(Object.entries(previous).map(([key, value]) => {
      if (value === null || !ids.has(value)) return [key,value];
      const pool = remaining.filter(tab => key ? tab.group === key : !tab.group || tab.group === expanded);
      return [key, pool.find(tab => tab.id > value)?.id ?? pool.at(-1)?.id ?? null];
    })));
    setTabs(remaining);
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
    event.preventDefault(); buttons[next].focus();
  }
  function tabButton(tab: TerminalTab) {
    const title = tab.title || tab.program;
    const status = tab.state === 'failed' ? 'error' : tab.detail;
    return <div key={tab.id} className="terminal-tab-group" style={themeStyle(tab.theme)} data-selected={selected === tab.id}>
      <button type="button" role="tab" id={'terminal-tab-' + tab.id} className="terminal-tab" data-terminal={tab.id} data-state={tab.state}
        aria-selected={selected === tab.id} aria-controls={'terminal-panel-' + tab.id} title={title} onClick={() => select(tab.id, tab.group)}>
        <span className="terminal-tab-dot" role="img" title={status} aria-label={status}/><span className="terminal-tab-title">{title}</span>
      </button>
      <button type="button" className="terminal-tab-close" data-close-terminal={tab.id} aria-label={'Close terminal ' + tab.id}
        onClick={() => remove([tab], 'Close this terminal and end its running process?')}><span>×</span></button>
    </div>;
  }
  return <div className="terminal-workspace" ref={workspace}>
    <div ref={strip} className="terminal-tabs" role="tablist" aria-label="Terminals" onKeyDown={moveTab}>
      {sections.map(tab => {
        if (action || !tab.group || !('cli' in tab.command)) return tabButton(tab);
        const group = tab.group;
        const items = groupTabs.get(group)!;
        const open = expanded === group;
        const groupActive = items.some(item => item.id === selected);
        const {node, method} = tab.command.cli;
        const name = nodes.find(entry => entry.id === node)?.name ?? tab.nodeName ?? 'Unknown node';
        const label = method + ' · ' + name;
        const status = groupStatus(items);
        return <div key={group} className="cli-group" style={groupStyle(group)} data-expanded={open}>
          <div className="cli-group-label">
          <button type="button" role="tab" className="cli-group-toggle" data-state={status} data-cli-group={group} aria-label={label} title={label}
            aria-selected={false} aria-expanded={open} onClick={() => {
              if (open) {
                setExpanded(undefined);
                if (groupActive) select(null);
              }
              else select(items.find(item => item.id === selections[group])?.id ?? items[0].id, group);
            }}>{!open && <span className="cli-group-star" role="img" title={status} aria-label={status}>★</span>}
            <span>{label}</span></button>
          {!open && <button type="button" className="terminal-tab-close" data-close-group={group} aria-label={'Close group ' + label}
            onClick={() => remove(items, 'Close all terminals in ' + label + ' and end their running processes?')}>×</button>}
        </div>{open && items.map(tabButton)}</div>;
      })}
      <button id="new-terminal" type="button" role="tab" aria-controls="terminal-launch" aria-selected={selected === null}
        aria-label="New terminal" title="New terminal" onClick={() => select(null)}><span>+</span></button>
    </div>
    <div className="terminal-deck"><div className="terminal-track" ref={track}>
      {tabs.map(tab => {
        const active = visible && selected === tab.id;
        const position = slides.indexOf(tab.id);
        if (tab.state === 'failed') return <div key={tab.id} className="terminal-frame terminal-failed-frame" data-outside={position < 0 || undefined}
          style={{...themeStyle(tab.theme),order:position}} inert={!active} hidden={!active} id={'terminal-panel-' + tab.id}
          role="tabpanel" aria-label={tab.title || tab.program}><pre className="terminal-launch-error" role="alert">{tab.detail}</pre></div>;
        return <TerminalView key={tab.id} id={tab.id} command={tab.command} position={position} sandbox={tab.sandbox} theme={tab.theme}
          onThemeChange={theme => chooseTheme(theme, tab.id)} connection={tab.state} visible={active} update={update} carousel={carousel}/>;
      })}
      <div id="terminal-launch" role="tabpanel" aria-labelledby="new-terminal" style={{order:slides.length}}
        hidden={!visible || selected !== null} inert={!visible || selected !== null}>
        <LaunchForm key={scope + ':' + formVersion} action={action} visible={visible && selected === null} theme={launchTheme} chooseTheme={chooseTheme}
          defaultSandbox={defaultSandbox} canChooseSandbox={canChooseSandbox} start={launch}/>
      </div>
    </div></div>
  </div>;
}
