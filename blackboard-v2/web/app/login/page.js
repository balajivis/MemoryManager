'use client';
import { useState } from 'react';
import { api } from '../../lib/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api('POST', '/auth/login', { email, password }, { noRedirect: true });
      window.location.assign('/board/');
    } catch (x) {
      setErr(x.status === 429 ? 'Too many attempts. Try again in 15 minutes.' : x.status === 401 ? "That email and password don't match." : x.status ? "That email and password don't match." : "Can't reach the board right now. Try again in a moment.");
      setBusy(false);
    }
  }
  return (
    <main className="narrow">
      <h1>Team board</h1>
      <p className="note">Sign in to your team&apos;s board.</p>
      <form className="card" onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <p className="notice" data-kind="error" role="alert">{err}</p>}
        <button className="btn primary" type="submit" disabled={busy}>Log in</button>
        <p className="note">Forgot your password? Ask the admin for a new invite link.</p>
      </form>
    </main>
  );
}
