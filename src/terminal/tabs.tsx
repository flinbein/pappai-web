import {type CSSProperties, useCallback, useLayoutEffect, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {TerminalView} from './view';
import {bindTabSwipe} from './trackpad';
import {bindStaticSlideSwipe} from './touch';
import {TabCarousel} from './carousel';
import {keyboardInset} from './viewport';
import {rememberTheme, savedTheme, themeStyle, type ThemeName} from './themes';
import {LaunchForm} from './launch-form';
import {activeTerminalPort, legacyTerminalWorkerId} from '../panel/shared-client';
import {useEntryState} from '../panel/entry-state';
import type {TerminalEntry, TerminalEvent, TerminalRequest, TerminalState} from './protocol';
import type {DirectoryNode} from '../panel/api';
import type {CliAction, TerminalStart} from './launch-input';

export type {TerminalState} from './protocol';
type TerminalTab = {
  closing?: boolean;
  theme: ThemeName;
  id: number;
  command?: TerminalStart;
  cli?: {node: string; method: string};
  epoch?: number;
  owner?: boolean;
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

function TerminalStatusIcon({state, label}: {state: TerminalState; label: string}) {
  const icon = useRef<HTMLSpanElement>(null);
  const previous = useRef(state);
  useLayoutEffect(() => {
    if (previous.current === state) return;
    previous.current = state;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const pulse = icon.current!.animate([
      {transform:'scale(1)', boxShadow:'0 0 0 0 transparent'},
      {transform:'scale(1.4)', boxShadow:'0 0 0 2px currentColor', offset:0.25},
      {transform:'scale(1)', boxShadow:'0 0 0 6px transparent'},
    ], {duration:650, iterations:state === 'online' ? 1 : 2, easing:'ease-out'});
    return () => pulse.cancel();
  }, [state]);
  return <span ref={icon} className="terminal-tab-dot" role="img" title={label} aria-label={label}/>;
}

interface Props {
  nodes: DirectoryNode[];
  action?: CliAction;
  entryKey?: string;
  visible: boolean;
  canChooseSandbox: boolean;
  defaultSandbox: boolean;
  onOnlineChange(online: boolean): void;
}

export default function TerminalTabs({nodes, action, entryKey, visible, canChooseSandbox, defaultSandbox, onOnlineChange}: Props) {
  const port = activeTerminalPort();
  // Direct WebSocket terminals live only within this document.
  const [pageId] = useState(() => crypto.getRandomValues(new Uint32Array(4)).join('-'));
  const [worker, setWorker] = useState(port ? undefined : pageId);
  const [entry, patchEntry] = useEntryState();
  const [restored, setRestored] = useState<{key:string; worker:string}>();
  const ready = !!entryKey && restored?.key === entryKey && restored.worker === worker;
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
    if (action || !tab.group) return tab.closing ? [] : [tab.id];
    if (expanded === tab.group) return groupTabs.get(tab.group)!.filter(item => !item.closing).map(item => item.id);
    return [];
  });

  function chooseTheme(theme: ThemeName, id?: number) {
    setLaunchTheme(theme);
    rememberTheme(theme);
    if (port && id !== undefined) post({type:'terminal.theme',id,theme});
    else if (id !== undefined) setTabs(items => items.map(tab => tab.id === id ? {...tab, theme} : tab));
  }
  const nextId = useRef(1);
  const launches = useRef(new Map<string,{group?:string; entryKey?:string}>());
  function post(message: TerminalRequest) { port?.postMessage(message); }
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
  useLayoutEffect(() => {
    if (!entryKey || !worker) {
      if (restored) setRestored(undefined);
      return;
    }
    const saved = entry.terminal;
    if (!ready) {
      // The first authoritative registry distinguishes a missing terminal from
      // one whose worker is still attaching. IDs start over in each worker.
      const id = !saved ? selected : saved.worker === worker && saved.scope === scope ? saved.id : null;
      const tab = tabs.find(item => item.id === id && !item.closing && (!scope || item.group === scope));
      select(tab?.id ?? null, tab?.group);
      setRestored({key:entryKey, worker});
    } else if (!saved || saved.worker !== worker || saved.scope !== scope || saved.id !== selected) {
      patchEntry({terminal:{worker, scope, id:selected}});
    }
  });
  function chooseTab(id: number | null, group?: string) {
    // A wheel gesture can commit a selection without focusing the browser window.
    const tab = tabs.find(item => item.id === id);
    if (port && tab && live(tab)) post({type:'terminal.take',id:tab.id});
    select(id, group);
  }
  const fromSwipe = useRef<(id: number | null) => void>(() => {});
  useLayoutEffect(() => {
    fromSwipe.current = id => {
      const editor = document.activeElement;
      const group = tabs.find(tab => tab.id === id)?.group;
      if (editor instanceof HTMLElement && editor.matches('.xterm-helper-textarea, #terminal-command') &&
          workspace.current?.contains(editor) && keyboardInset() > 60) {
        flushSync(() => chooseTab(id, group));
        const input = workspace.current.querySelector<HTMLElement>(id === null ? '#terminal-command' : '.terminal-frame:not([hidden]) .xterm-helper-textarea:not([disabled])');
        input?.focus({preventScroll: true});
      } else chooseTab(id, group);
    };
  });
  useLayoutEffect(() => {
    const bindings = new AbortController();
    const controller = new TabCarousel(track.current!, id => fromSwipe.current(id));
    carousel.current = controller;
    bindTabSwipe(workspace.current!, controller, bindings.signal);
    bindStaticSlideSwipe(track.current!, controller, bindings.signal);
    return () => { bindings.abort(); controller.dispose(); carousel.current = null; };
  }, []);
  useLayoutEffect(() => { carousel.current?.sync(visible && ready ? [...slides, null] : [], selected); });
  const online = tabs.some(tab => !tab.closing && tab.state === 'online');
  useLayoutEffect(() => { if (!port) onOnlineChange(online); }, [port, online, onOnlineChange]);
  useLayoutEffect(() => {
    if (visible) strip.current?.querySelector('.terminal-tab-group[data-selected=true], #new-terminal[aria-selected=true]')?.scrollIntoView({block:'nearest', inline:'nearest'});
  }, [visible, selected, scope, expanded]);

  const update = useCallback((id: number, change: TerminalUpdate) => {
    setTabs(previous => previous.map(tab => tab.id === id ? {...tab, ...change} : tab));
  }, []);

  function launch(command: TerminalStart, sandbox: boolean) {

    const group = 'cli' in command ? groupId(command.cli) : undefined;
    const program = 'cli' in command ? command.cli.method : command.argv[0].split('/').pop() || command.argv[0];
    const nodeName = 'cli' in command ? nodes.find(node => node.id === command.cli.node)?.name : undefined;
    if (port) {
      const requestId = crypto.randomUUID();
      launches.current.set(requestId,{group,entryKey});
      post({type:'terminal.launch',requestId,command,sandbox,theme:launchTheme,nodeName});
      return;
    }
    const id = nextId.current++;
    setTabs(previous => [...previous, {id, command, cli:'cli' in command ? command.cli : undefined, group, nodeName, sandbox, program, title:'', state:'connecting', detail:'starting', theme:launchTheme}]);
    select(id, group);
    setFormVersion(value => value + 1);
  }
  function remove(items: TerminalTab[], message: string) {
    if (items.some(live) && !window.confirm(message)) return;
    const ids = new Set(items.map(item => item.id));
    if (port) post({type:'terminal.remove',ids:[...ids]});
    else reconcile(ids);
  }
  function reconcile(ids: Set<number>, incoming?: TerminalTab[]) {
    const remaining = incoming ?? tabs.filter(tab => !tab.closing && !ids.has(tab.id));
    // Unmount the PTYs now. Only their inert strip items stay for the exit transition.
    flushSync(() => {
      setSelections(previous => Object.fromEntries(Object.entries(previous).map(([key, value]) => {
        if (value === null || !ids.has(value)) return [key,value];
        if (key === scope && entryKey && !visible) return [key,null];
        const pool = remaining.filter(tab => key ? tab.group === key : !tab.group || tab.group === expanded);
        return [key, pool.find(tab => tab.id > value)?.id ?? pool.at(-1)?.id ?? null];
      })));
      setTabs(previous => {
        const byId = new Map(incoming?.map(tab => [tab.id,tab]));
        const existing = previous.map(tab => {
          if (ids.has(tab.id)) return {...tab,closing:true};
          const replacement = byId.get(tab.id);
          byId.delete(tab.id);
          return replacement ?? tab;
        });
        return existing.concat([...byId.values()]);
      });
    });
    const exits = Array.from(strip.current!.querySelectorAll('.strip-item[data-closing=true]'))
      .flatMap(item => item.getAnimations().map(animation => animation.finished));
    void Promise.allSettled(exits).then(() => setTabs(previous => previous.filter(tab => !ids.has(tab.id))));
  }
  const registryHandler = useRef<(event: TerminalEvent) => void>(() => {});
  useLayoutEffect(() => {
    registryHandler.current = event => {
      if (event.type === 'terminal.created') {
        const launch = launches.current.get(event.requestId);
        if (!launch) return;
        launches.current.delete(event.requestId);
        if (launch.entryKey === entryKey) {
          select(event.id,launch.group);
          setFormVersion(value => value + 1);
        }
      } else if (event.type === 'terminal.registry') {
        if (event.worker) setWorker(event.worker);
        else if (port && !worker) {
          void legacyTerminalWorkerId(port).then(id => setWorker(id ?? pageId));
        }
        const incoming = event.entries.map((entry: TerminalEntry) => ({
          ...entry,group:entry.cli ? groupId(entry.cli) : undefined,
        }));
        const ids = new Set(incoming.map(item => item.id));
        const removed = new Set(tabs.filter(tab => !tab.closing && !ids.has(tab.id)).map(tab => tab.id));
        if (removed.size) reconcile(removed,incoming);
        else setTabs(previous => [...incoming,...previous.filter(tab => tab.closing)].sort((a,b)=>a.id-b.id));
      }
    };
  });
  useLayoutEffect(() => {
    if (!port) return;
    const receive = ({data}: MessageEvent<TerminalEvent>) => registryHandler.current(data);
    port.addEventListener('message',receive);
    port.postMessage({type:'terminal.list'} satisfies TerminalRequest);
    return () => port.removeEventListener('message',receive);
  }, [port]);
  function moveTab(event: React.KeyboardEvent) {
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return;
    const buttons = Array.from(strip.current!.querySelectorAll<HTMLButtonElement>('[role=tab]:not([inert] *)'));
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
    return <div key={tab.id} className="strip-item" inert={tab.closing} data-closing={tab.closing}>
      <div className="terminal-tab-group" style={themeStyle(tab.theme)} data-selected={selected === tab.id}>
        <button type="button" role="tab" id={'terminal-tab-' + tab.id} className="terminal-tab" data-terminal={tab.id} data-state={tab.state}
          aria-selected={selected === tab.id} aria-controls={'terminal-panel-' + tab.id} title={title} onClick={() => chooseTab(tab.id, tab.group)}>
          <TerminalStatusIcon state={tab.state} label={status}/><span className="terminal-tab-title">{title}</span>
        </button>
        <button type="button" className="terminal-tab-close" data-close-terminal={tab.id} aria-label={'Close terminal ' + tab.id}
          onClick={() => remove([tab], 'Close this terminal and end its running process?')}><span>×</span></button>
      </div>
    </div>;
  }
  return <div className="terminal-workspace" ref={workspace}>
    <div ref={strip} className="terminal-tabs" role="tablist" aria-label="Terminals" onKeyDown={moveTab}>
      {sections.map(tab => {
        if (action || !tab.group || !tab.cli) return tabButton(tab);
        const group = tab.group;
        const items = groupTabs.get(group)!;
        const available = items.filter(item => !item.closing);
        const open = expanded === group;
        const groupActive = items.some(item => item.id === selected);
        const {node, method} = tab.cli;
        const name = nodes.find(entry => entry.id === node)?.name ?? tab.nodeName ?? 'Unknown node';
        const label = method + ' · ' + name;
        const status = groupStatus(items);
        return <div key={group} className="strip-item" inert={!available.length} data-closing={!available.length}>
          <div className="cli-group" style={groupStyle(group)} data-expanded={open}>
            <div className="cli-group-label">
              <button type="button" role="tab" className="cli-group-toggle" data-state={status} data-cli-group={group}
                aria-label={label} title={label} aria-selected={false} aria-expanded={open} onClick={() => {
                  if (open) {
                    setExpanded(undefined);
                    if (groupActive) select(null);
                  } else chooseTab(available.find(item => item.id === selections[group])?.id ?? available[0].id, group);
                }}>
                <span className="group-reveal" inert={open}><span className="cli-group-star" role="img" title={status} aria-label={status}>★</span></span>
                <span>{label}</span>
              </button>
              <div className="group-reveal" inert={open}>
                <button type="button" className="terminal-tab-close" data-close-group={group} aria-label={'Close group ' + label}
                  onClick={() => remove(available, 'Close all terminals in ' + label + ' and end their running processes?')}>×</button>
              </div>
            </div>
            <div className="group-reveal" inert={!open} onTransitionEnd={event => {
              if (open && event.target === event.currentTarget && event.propertyName === 'width') {
                event.currentTarget.querySelector('[data-selected=true]')?.scrollIntoView({block:'nearest',inline:'nearest'});
              }
            }}>
              <div className="group-members">{items.map(tabButton)}</div>
            </div>
          </div>
        </div>;
      })}
      <button id="new-terminal" type="button" role="tab" aria-controls="terminal-launch" aria-selected={selected === null}
        aria-label="New terminal" title="New terminal" onClick={() => select(null)}><span>+</span></button>
    </div>
    <div className="terminal-deck"><div className="terminal-track" ref={track}>
      {tabs.filter(tab => !tab.closing).map(tab => {
        const active = ready && visible && selected === tab.id;
        const position = slides.indexOf(tab.id);
        if (tab.state === 'failed') return <div key={tab.id} className="terminal-frame terminal-failed-frame" data-outside={position < 0 || undefined}
          style={{...themeStyle(tab.theme),order:position}} inert={!active} hidden={!active} id={'terminal-panel-' + tab.id}
          role="tabpanel" aria-label={tab.title || tab.program}><pre className="terminal-launch-error" role="alert">{tab.detail}</pre></div>;
        return <TerminalView key={tab.id} id={tab.id} command={tab.command} port={port} owner={tab.owner} epoch={tab.epoch} position={position} sandbox={tab.sandbox} theme={tab.theme}
          onThemeChange={theme => chooseTheme(theme, tab.id)} connection={tab.state} visible={active} update={update} carousel={carousel}/>;
      })}
      <div id="terminal-launch" role="tabpanel" aria-labelledby="new-terminal" style={{order:slides.length}}
        hidden={!ready || !visible || selected !== null} inert={!ready || !visible || selected !== null}>
        <LaunchForm key={scope + ':' + formVersion} action={action} visible={ready && visible && selected === null} theme={launchTheme} chooseTheme={chooseTheme}
          defaultSandbox={defaultSandbox} canChooseSandbox={canChooseSandbox} start={launch}/>
      </div>
    </div></div>
  </div>;
}
