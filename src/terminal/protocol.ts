import type {Terminal} from '@xterm/xterm';
import type {TerminalStart} from './launch-input';
import type {ThemeName} from './themes';

export type TerminalState = 'connecting' | 'online' | 'closed' | 'nonzero' | 'failed';
export interface TerminalEntry {
  id: number;
  cli?: {node: string; method: string};
  nodeName?: string;
  sandbox: boolean;
  program: string;
  title: string;
  state: TerminalState;
  detail: string;
  theme: ThemeName;
  owner: boolean;
  epoch: number;
}

interface Size {cols: number; rows: number}
interface Address {id: number; epoch: number}
type Frame = Address & {seq: number};

export type TerminalRequest =
  | {type: 'terminal.list'}
  | {type: 'terminal.registryAck'; seq: number}
  | ({type: 'terminal.launch'; requestId: string; command: TerminalStart; sandbox: boolean; theme: ThemeName; nodeName?: string} & Partial<Size>)
  | {type: 'terminal.watch' | 'terminal.unwatch'; id: number}
  | ({type: 'terminal.take'; id: number} & Partial<Size>)
  | ({type: 'terminal.input'; data: Uint8Array} & Address)
  | ({type: 'terminal.size'} & Address & Size)
  | {type: 'terminal.ack'; id: number; seq: number}
  | {type: 'terminal.theme'; id: number; theme: ThemeName}
  | {type: 'terminal.remove'; ids: number[]};

export type TerminalEvent =
  | {type: 'terminal.registry'; worker?: string; entries: TerminalEntry[]; seq: number}
  | {type: 'terminal.created'; id: number; requestId: string}
  | ({type: 'terminal.snapshot'; owner: boolean; data: string} & Frame & Size)
  | ({type: 'terminal.output'; data: Uint8Array} & Frame)
  | ({type: 'terminal.resize'} & Frame & Size);

// The worker answers these queries from its canonical parser even when every
// page is hidden. Let the owner handle browser-only reports such as OSC colors.
export function useWorkerDeviceReplies(term: Pick<Terminal, 'parser'>) {
  for (const final of ['n', 'c']) {
    term.parser.registerCsiHandler({final}, () => true);
    term.parser.registerCsiHandler({prefix: final === 'n' ? '?' : '>', final}, () => true);
  }
  term.parser.registerCsiHandler({intermediates:'$', final:'p'}, () => true);
  term.parser.registerCsiHandler({prefix:'?', intermediates:'$', final:'p'}, () => true);
  term.parser.registerCsiHandler({final:'t'}, params => params[0] === 18);
  term.parser.registerDcsHandler({intermediates:'$', final:'q'}, () => true);
}
