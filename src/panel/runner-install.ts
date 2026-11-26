import type { TerminalEnd } from '../terminal/session';

export type SourceType = 'npm' | 'git' | 'custom';
export type Operation = 'add' | 'update';
export const runnerName = /^[a-z][a-z0-9_-]{0,63}$/;

export function suggestedName(type: SourceType, source: string) {
  if (type === 'custom') return '';
  const spec = source.trim();
  const leaf = type === 'npm'
    ? /^(?:@[\w.-]+\/)?([\w.-]+)(?:@[^/]+)?$/.exec(spec)?.[1]
    : spec.replace(/\/+$/, '').split(/[/:]/).pop()?.replace(/\.git$/, '');
  return (leaf ?? '').replace(/^pappai-runner-/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 64);
}

export function nameFromEntrypoint(path: string) {
  const prefix = '/run/pappai/private/runners/';
  if (path.startsWith(prefix) && !/[\x00-\x1f\x7f]/.test(path)) {
    const [name, ...parts] = path.slice(prefix.length).split('/');
    if (runnerName.test(name) && parts.length && parts.every(part => part && part !== '.' && part !== '..')) return name;
  }
  throw Error('Enter an absolute entrypoint under /run/pappai/private/runners/<name>/.');
}

export function prepareCommand(operation: Operation, type: 'npm' | 'git', name: string, source: string, ref: string) {
  const args = [operation, type, name, source, ...(type === 'git' && ref ? [ref] : [])];
  if (!runnerName.test(name) || !source || args.some(arg => /[\x00-\x1f\x7f]/.test(arg))) {
    throw Error('Enter a valid installation name and source.');
  }
  const quote = (arg: string) => "'" + arg.replaceAll("'", "'\\''") + "'";
  return ['node', '/opt/pappai/scripts/prepare-runner.mjs', ...args.map(quote)].join(' ');
}

// PTY frames and UTF-8 characters may split anywhere. Keep only the final logical
// line, independently of xterm's screen width, render queue and scrollback limit.
export function installerResult() {
  const decoder = new TextDecoder();
  const limit = 16384;
  let last = '';
  let line = '';
  let overflow = false;

  function consume(text: string) {
    const parts = text.split('\n');
    parts.forEach((part, i) => {
      if (i) {
        if (overflow || line.trim()) last = overflow ? '' : line.trimEnd();
        line = '';
        overflow = false;
      }
      if (line.length + part.length > limit) overflow = true;
      if (!overflow) line += part;
    });
  }
  return {
    write(bytes: Uint8Array) { consume(decoder.decode(bytes, { stream: true })); },
    finish(end: TerminalEnd, name: string): string {
      if ('error' in end) throw Error(end.error);
      if ('disconnected' in end) throw Error('Installer terminal disconnected before completion.');
      if (end.exitCode !== 0) throw Error('Installer exited with code ' + end.exitCode + '.');
      consume(decoder.decode() + '\n');
      const marker = 'PAPPAI_RESULT ';
      if (!last.startsWith(marker)) throw Error('Installer did not return a final PAPPAI_RESULT line.');
      const result = JSON.parse(last.slice(marker.length));
      if (typeof result?.entrypoint !== 'string' || nameFromEntrypoint(result.entrypoint) !== name) {
        throw Error('Installer returned an invalid entrypoint for ' + name + '.');
      }
      return result.entrypoint;
    },
  };
}
