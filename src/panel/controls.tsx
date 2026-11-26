import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, FormEvent, ReactNode } from 'react';
import { errorMessage } from './api';
import type { DirectoryNode, NodeType } from './api';

export function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}

export type Feedback = (message: string) => void;
const Submitting = createContext(false);

interface FormProps {
  id: string;
  submit: (form: HTMLFormElement) => Promise<void>;
  feedback: Feedback;
  children: ReactNode;
  hidden?: boolean;
}
export function Form({ id, submit, feedback, children, hidden }: FormProps) {
  const [pending, setPending] = useState(false);
  const mounted = useMounted();
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    feedback('');
    setPending(true);
    try {
      await submit(event.currentTarget);
    } catch (error) {
      if (mounted.current) feedback(errorMessage(error));
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  return <form id={id} hidden={hidden} onSubmit={handleSubmit}>
    <Submitting.Provider value={pending}>{children}</Submitting.Provider>
  </form>;
}

export function Submit({ disabled, children }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const pending = useContext(Submitting);
  return <button type="submit" disabled={disabled || pending}>{children}</button>;
}

interface ActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  run: () => Promise<void>;
  feedback: Feedback;
}
export function Action({ run, feedback, children, disabled, ...props }: ActionProps) {
  const [pending, setPending] = useState(false);
  const mounted = useMounted();
  async function handleClick() {
    feedback('');
    setPending(true);
    try {
      await run();
    } catch (error) {
      if (mounted.current) feedback(errorMessage(error));
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  return <button {...props} type="button" disabled={disabled || pending} onClick={handleClick}>{children}</button>;
}

export function field(form: HTMLFormElement, name: string) {
  return String(new FormData(form).get(name) ?? '');
}

export function NoRestrictions({ onSelect }: { onSelect: () => void }) {
  return <>
    <button type="button" className="secondary" onClick={onSelect}>No restrictions</button>
    <small>Removes this node’s own limits. Other nodes on its permission paths still apply their rules.</small>
  </>;
}

export function NodeOptions({ nodes, type, placeholder }: { nodes: DirectoryNode[]; type: NodeType; placeholder: string }) {
  return <><option value="">{placeholder}</option>{nodes.filter(node => node.type === type).map(node =>
    <option key={node.id} value={node.id}>{node.name} · {node.id}</option>)}</>;
}

export function Dialog({ id, close, children }: { id: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return <dialog id={id} ref={ref} onCancel={close}>{children}</dialog>;
}
