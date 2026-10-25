'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function Invite() {
  const [token, setToken] = useState(null);
  const [who, setWho] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') || '';
    setToken(t);
    if (!t) return setErr('This invite link is missing its token.');
    api('GET', '/auth/invite/' + encodeURIComponent(t), undefined, { noRedirect: true })
      .then(setWho).catch(() => setErr('This invite link has expired or was already used. Ask the admin for a new one.'));
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (password.length < 12) return setErr('Use at least 12 characters.');
    if (password !== confirmPw) return setErr("The two passwords don't match.");
    setBusy(true); setErr('');
    try {
      await api('POST', '/auth/invite/' + encodeURIComponent(token), { password }, { noRedirect: true });
      window.location.assign('/board/');
    } catch (x) { setErr(x.message); setBusy(false); }
  }
  return (
    <main className="narrow">
      <h1>Set your password</h1>
      {who && (
        <form className="card" onSubmit={submit}>
          <h2>You&apos;re invited to the team board.</h2>
          <label htmlFor="nm">Your name</label><input id="nm" value={who.name} readOnly />
          <label htmlFor="em">Email</label><input id="em" value={who.email} readOnly />
          <label htmlFor="pw">Password</label><p className="note">At least 12 characters. A short sentence works well.</p>
          <input id="pw" type="password" autoComplete="new-password" minLength={12} required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          <label htmlFor="pw2">Confirm password</label>
          <input id="pw2" type="password" autoComplete="new-password" required value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          {err && <p className="notice" data-kind="error" role="alert">{err}</p>}
          <button className="btn primary" type="submit" disabled={busy}>Create account</button>
        </form>
      )}
      {!who && err && <p className="notice" data-kind="error" role="alert">{err}</p>}
    </main>
  );
}
