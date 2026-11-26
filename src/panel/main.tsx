import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { errorMessage, getSession, login, logout, recover, register, startPanelConnection, stopPanelConnection } from './api';
import type { Session } from './api';
import { Action, field, Form, Submit } from './controls';
import type { Feedback } from './controls';
import { Workspace } from './workspace';
import './style.css';

function SignIn({ reload, feedback }: { reload: () => Promise<void>; feedback: Feedback }) {
  return <section id="signin">
    <h1>Sign in to your workspace</h1>
    <Action id="login" feedback={feedback} run={async () => { await login(); await reload(); }}>Sign in with a passkey</Action>
    <details><summary>Register a passkey</summary>
      <Form id="activate" feedback={feedback} submit={async form => {
        await register(field(form, 'email'), field(form, 'code'));
        form.reset();
        await reload();
      }}>
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>One-time code<input name="code" autoComplete="one-time-code" required /></label>
        <Submit>Register</Submit>
      </Form>
    </details>
    <details><summary>Get a code by email</summary>
      <Form id="recovery" feedback={feedback} submit={async form => {
        await recover(field(form, 'email'));
        feedback('If recovery is available, you’ll receive a code at that email address.');
      }}>
        <label>Recovery email address<input name="email" type="email" autoComplete="email" required /></label>
        <Submit>Request code</Submit>
      </Form>
    </details>
  </section>;
}

function Panel() {
  const [session, setSession] = useState<Session>();
  const [notice, setNotice] = useState('');
  const revision = useRef(0);
  const reload = useCallback(async () => {
    const attempt = ++revision.current;
    const next = await getSession();
    if (attempt !== revision.current) return;
    if (next.user) {
      startPanelConnection(next.user, reason => {
        revision.current++;
        stopPanelConnection();
        setSession({ user: null, canChooseSandbox: false, canManageApps: false });
        setNotice(reason ?? 'Your session has ended. Sign in again.');
      }, next.browserSession);
    } else {
      stopPanelConnection();
    }
    setSession(next);
    setNotice('');
  }, []);
  useEffect(() => {
    const load = () => void reload().catch(error => setNotice(errorMessage(error)));
    const leave = () => { revision.current++; stopPanelConnection(); };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) {
        flushSync(() => setSession(undefined));
        load();
      }
    };
    load();
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', restore);
      leave();
    };
  }, [reload]);

  return <>
    <main>
      {session && (session.user
        ? <Workspace key={session.browserSession ?? session.user} session={session} feedback={setNotice} signOut={async () => { await logout(); await reload(); }} />
        : <SignIn reload={reload} feedback={setNotice} />)}
      <p id="notice" role="status">{notice}</p>
    </main>
  </>;
}

const router = createBrowserRouter([{ path: '*', element: <Panel /> }]);
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
