import {useCallback, useEffect, useRef, useState, type RefObject} from 'react';

import type {TerminalSession} from './session';

import {snapshot} from './copy-mode';
type CopyView = ReturnType<typeof snapshot>;

export async function writeSelection(text: string) {
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
    if (!text) { setCopyView(snapshot(current.term)); return; }
    const fallback = snapshot(current.term);
    const copied = await writeSelection(text);
    if (session.current !== current || !current.visible()) return;
    if (copied) report('Copied.');
    else setCopyView(fallback);
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
