import {useCallback, useLayoutEffect, useRef, useState, type RefObject} from 'react';
import type {Terminal} from '@xterm/xterm';
import type {TerminalSession} from './session';

type ClipboardView = {mode: 'copy' | 'paste'; text: string; select: boolean};

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

export function useTerminalClipboard(session: RefObject<TerminalSession | null>, report: (message: string) => void) {
  const [view, setView] = useState<ClipboardView | null>(null);
  const copy = useCallback(async () => {
    const current = session.current;
    if (!current) return;
    const text = current.term.getSelection();
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
        report('Скопировано');
        return;
      } catch { /* The dialog also works when clipboard permission is denied. */ }
    }
    if (session.current === current) setView({mode: 'copy', text: text || terminalText(current.term), select: !!text});
  }, [session, report]);
  const paste = useCallback(async () => {
    const current = session.current;
    if (!current?.online()) return;
    current.clearModifiers();
    let text: string;
    try { text = await navigator.clipboard.readText(); }
    catch {
      if (current.online()) setView({mode: 'paste', text: '', select: false});
      return;
    }
    if (current.online()) {
      current.term.paste(text);
      current.term.focus();
    }
  }, [session]);
  const disconnect = useCallback(() => setView(v => v?.mode === 'paste' ? null : v), []);
  return {view, setView, copy, paste, disconnect};
}

interface ClipboardDialogProps {
  view: ClipboardView | null;
  session: TerminalSession | null;
  onClose(): void;
  report(message: string): void;
}

export function ClipboardDialog({view, session, onClose, report}: ClipboardDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [systemCopy, setSystemCopy] = useState(false);
  const readOnly = view?.mode === 'copy';

  useLayoutEffect(() => {
    const modal = dialog.current;
    const input = field.current;
    if (!modal || !input) return;
    if (!view) {
      if (modal.open) modal.close();
      input.value = '';
      return;
    }
    setSystemCopy(false);
    input.value = view.text;
    if (!modal.open) modal.showModal();
    input.focus();
    if (view.select) input.select();
    else input.setSelectionRange(view.text.length, view.text.length);
  }, [view]);

  async function apply() {
    const input = field.current;
    if (!input || !view) return;
    if (readOnly) {
      const selection = input.value.slice(input.selectionStart, input.selectionEnd);
      if (!selection) { input.focus(); return; }
      try {
        await navigator.clipboard.writeText(selection);
        report('Скопировано');
      } catch {
        setSystemCopy(true);
        input.focus();
        return;
      }
    } else if (session?.online()) {
      session.clearModifiers();
      session.term.paste(input.value);
    }
    dialog.current?.close();
  }
  return <dialog ref={dialog} id="clipboard-dialog" aria-labelledby="clipboard-label" onClose={onClose}>
    <label htmlFor="clipboard-text" id="clipboard-label">
      {systemCopy ? 'Используйте «Копировать» в системном меню' : readOnly ? 'Выделите и скопируйте текст' : 'Вставьте текст'}
    </label>
    <textarea ref={field} id="clipboard-text" rows={7} spellCheck={false} readOnly={readOnly}/>
    <div className="clipboard-actions">
      <button id="clipboard-close" onClick={() => dialog.current?.close()}>Закрыть</button>
      <button id="clipboard-apply" onClick={apply}>{readOnly ? 'Копировать выделенное' : 'Отправить в терминал'}</button>
    </div>
  </dialog>;
}
