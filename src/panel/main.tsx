import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { errorMessage, getSession, login, logout, recover, register } from './api';
import type { Session } from './api';
import { Action, field, Form, Submit } from './controls';
import type { Feedback } from './controls';
import { Workspace } from './workspace';
import './style.css';

function SignIn({ reload, feedback }: { reload: () => Promise<void>; feedback: Feedback }) {
  return <section id="signin">
    <h1>Вход в workspace</h1>
    <Action id="login" feedback={feedback} run={async () => { await login(); await reload(); }}>Войти с passkey</Action>
    <details><summary>Зарегистрировать passkey</summary>
      <Form id="activate" feedback={feedback} submit={async form => {
        await register(field(form, 'email'), field(form, 'code'));
        form.reset();
        await reload();
      }}>
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Одноразовый код<input name="code" autoComplete="one-time-code" required /></label>
        <Submit>Зарегистрировать</Submit>
      </Form>
    </details>
    <details><summary>Получить код по email</summary>
      <Form id="recovery" feedback={feedback} submit={async form => {
        await recover(field(form, 'email'));
        feedback('Если восстановление доступно, код придёт на указанный адрес.');
      }}>
        <label>Адрес для восстановления<input name="email" type="email" autoComplete="email" required /></label>
        <Submit>Запросить код</Submit>
      </Form>
    </details>
  </section>;
}

function Panel() {
  const [session, setSession] = useState<Session>();
  const [notice, setNotice] = useState('');
  async function reload() {
    setSession(await getSession());
    setNotice('');
  }
  useEffect(() => { void reload().catch(error => setNotice(errorMessage(error))); }, []);

  return <>
    <header className="topbar"><strong>pappai</strong><span>Workspace</span>
      {session?.user && <Action id="logout" feedback={setNotice} run={async () => { await logout(); await reload(); }}>Выйти</Action>}
    </header>
    <main>
      {session && (session.user
        ? <Workspace key={session.user} session={session} feedback={setNotice} />
        : <SignIn reload={reload} feedback={setNotice} />)}
      <p id="notice" role="status">{notice}</p>
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<Panel />);
