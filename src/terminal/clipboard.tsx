import {useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject} from 'react';
import type {Terminal} from '@xterm/xterm';
import type {TerminalSession} from './session';

type CopyView = {text: string; selected: boolean};

function terminalText(term: Terminal) {
  const buffer = term.buffer.active;
  let text = '';
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;
    if (i && !line.isWrapped) text += '\n';
    text += line.translateToString(!buffer.getLine(i + 1)?.isWrapped);
  }
  return text.trimEnd();
}

async function writeSelection(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // In an insecure context Chrome may still allow a user-initiated native copy.
    let copied = false;
    function copy(event: ClipboardEvent) {
      if (!event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData('text/plain', text);
      copied = true;
    }
    document.addEventListener('copy', copy, true);
    try { return document.execCommand('copy') && copied; }
    catch { return false; }
    finally { document.removeEventListener('copy', copy, true); }
  }
}

export function useTerminalClipboard(session: RefObject<TerminalSession | null>, report: (message: string) => void) {
  const [copyView, setCopyView] = useState<CopyView | null>(null);
  const [nativePaste, setNativePaste] = useState(false);
  const copy = useCallback(async () => {
    const current = session.current;
    if (!current?.visible()) return;
    const text = current.term.getSelection();
    const copied = text && await writeSelection(text);
    if (session.current !== current || !current.visible()) return;
    if (copied) report('Copied.');
    else setCopyView({text: text || terminalText(current.term), selected: !!text});
  }, [session, report]);
  const paste = useCallback(async () => {
    const current = session.current;
    if (!current?.online() || !current.visible()) return;
    try {
      const text = await navigator.clipboard.readText();
      if (session.current === current && current.online() && current.visible()) {
        current.paste(text);
        current.term.focus();
      }
    } catch {
      if (session.current === current && current.online() && current.visible()) setNativePaste(true);
    }
  }, [session]);
  return {copy, paste, copyView, setCopyView, nativePaste, setNativePaste};
}

export function PasteField({send, dismiss}: {send(text: string): void; dismiss(): void}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus({preventScroll: true}); }, []);
  return <div className="terminal-native-paste">
    <textarea id="paste-input" ref={field} rows={1} spellCheck={false} aria-label="System paste"
      placeholder="Paste from your keyboard or touch and hold here"
      onPaste={event => { event.preventDefault(); send(event.clipboardData.getData('text/plain')); }}
      onInput={event => {
        if (!(event.nativeEvent as InputEvent).isComposing && event.currentTarget.value) send(event.currentTarget.value);
      }}
      onCompositionEnd={event => { if (event.currentTarget.value) send(event.currentTarget.value); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); dismiss(); } }}/>
    <button aria-label="Close paste field" onClick={dismiss}>×</button>
  </div>;
}

export function CopyDialog({view, onClose, report}: {view: CopyView; onClose(): void; report(text: string): void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [systemCopy, setSystemCopy] = useState(false);
  useLayoutEffect(() => {
    const input = field.current!;
    dialog.current!.showModal();
    input.focus();
    if (view.selected) input.select();
    else input.setSelectionRange(view.text.length, view.text.length);
  }, [view]);
  async function apply() {
    const input = field.current!;
    const text = input.value.slice(input.selectionStart, input.selectionEnd);
    if (!text) { input.focus(); return; }
    if (await writeSelection(text)) { report('Copied.'); dialog.current?.close(); }
    else { setSystemCopy(true); input.focus(); }
  }
  return <dialog ref={dialog} className="terminal-copy-dialog" aria-labelledby="clipboard-label" onClose={onClose}>
    <label htmlFor="clipboard-text" id="clipboard-label">
      {systemCopy ? 'Use Copy in the system menu' : 'Select text to copy'}
    </label>
    <textarea ref={field} id="clipboard-text" rows={7} spellCheck={false} readOnly defaultValue={view.text}/>
    <div className="terminal-dialog-actions">
      <button onClick={() => dialog.current?.close()}>Close</button>
      <button id="clipboard-apply" onClick={apply}>Copy selection</button>
    </div>
  </dialog>;
}
