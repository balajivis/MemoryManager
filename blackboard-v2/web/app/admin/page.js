'use client';
import { useEffect, useState } from 'react';
import { api, loadMe } from '../../lib/api';

const tok = (name, token) => { const lines = 'BB_URL=' + window.location.origin + '/board/api\nBB_TOKEN=' + token; return { text: 'New token for ' + name + ':', secret: lines, copy: lines, token: true }; };
const list = (r, key) => (Array.isArray(r) ? r : (r && r[key]) || []);

export default function Admin() {
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [agents, setAgents] = useState([]);
  const [msg, setMsg] = useState(null);   // {text, secret}
  const [err, setErr] = useState('');
  const [inv, setInv] = useState({ email: '', name: '', role: 'member' });
  const [ag, setAg] = useState({ name: '', role: '' });

  async function refresh() {
    const [u, a] = await Promise.all([api('GET', '/admin/users'), api('GET', '/admin/agents')]);
    setUsers(list(u, 'users')); setAgents(list(a, 'agents'));
  }
  useEffect(() => {
    loadMe().then((u) => { if (u.role !== 'admin') return window.location.assign('/board/'); setMe(u); return refresh(); }).catch((e) => setErr(e.message));
  }, []);

  async function act(fn, show) {
    setErr(''); setMsg(null);
    try { const r = await fn(); if (show) setMsg(show(r)); await refresh(); } catch (e) { setErr(e.message); }
  }
  if (!me) return <main className="narrow"><p role="status">Loading…</p></main>;

  return (
    <main className="wrap">
      <header className="top"><h1>Admin</h1><a className="btn" href="/board/">Back to board</a></header>
      {err && <p className="notice" data-kind="error" role="alert">{err}</p>}
      {msg && <div className="card" role="status"><p>{msg.text}</p><code className="secret">{msg.secret}</code>
        <div className="row"><button className="btn small" onClick={() => navigator.clipboard && navigator.clipboard.writeText(msg.copy || msg.secret)}>{msg.token ? 'Copy token lines' : 'Copy link'}</button></div>
        <p className="note">{msg.token ? "Copy this token now. You won't see it again." : 'Send this link yourself. It works once and expires in 7 days.'}</p></div>}

      <section className="panel" id="people" aria-labelledby="h-users">
        <div className="panel-head"><h2 id="h-users">People</h2></div>
        <ul className="roster">
          {users.map((u) => (
            <li key={u.id}><div className="bot" aria-hidden="true">{u.name.slice(0, 2).toUpperCase()}</div>
              <div><div className="r-name">{u.name}</div><div className="r-doing">{u.email} · {u.role}</div></div>
              {u.id !== me.id && <button className="btn small" onClick={() => confirm('Remove ' + u.name + '? They are signed out everywhere and lose access.') && act(() => api('DELETE', '/admin/users/' + u.id))}>Remove</button>}
            </li>))}
        </ul>
      </section>

      <section className="panel" aria-labelledby="h-inv">
        <div className="panel-head"><h2 id="h-inv">Invite a person</h2><span className="hint">One use, expires in 7 days</span></div>
        <form className="inline" onSubmit={(e) => { e.preventDefault(); act(() => api('POST', '/admin/invites', inv), (r) => ({ text: 'Invite link for ' + inv.name + ':', secret: r.url })); }}>
          <label className="sr" htmlFor="i-email">Email</label>
          <input id="i-email" type="email" required placeholder="Email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />
          <label className="sr" htmlFor="i-name">Name</label>
          <input id="i-name" type="text" required placeholder="Name" value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} />
          <label className="sr" htmlFor="i-role">Role</label>
          <select id="i-role" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}><option value="member">Member</option><option value="admin">Admin</option></select>
          <button className="btn primary" type="submit">Create invite link</button>
        </form>
      </section>

      <section className="panel" id="agents" aria-labelledby="h-agents">
        <div className="panel-head"><h2 id="h-agents">Agents and tokens</h2></div>
        <ul className="roster">
          {agents.map((a) => (
            <li key={a.name}><div className="bot" aria-hidden="true">AI</div>
              <div><div className="r-name">{a.name}</div><div className="r-doing">{a.role}</div></div>
              <span className="row">
                <button className="btn small" onClick={() => act(() => api('POST', '/admin/agents/' + a.name + '/rotate'), (r) => tok(a.name, r.token))}>Rotate token</button>
                <button className="btn small" onClick={() => confirm('Revoke ' + a.name + "'s token and delete the agent? Its bb commands will fail until you make a new one.") && act(() => api('DELETE', '/admin/agents/' + a.name))}>Delete</button>
              </span></li>))}
        </ul>
        <form className="inline" onSubmit={(e) => { e.preventDefault(); act(() => api('POST', '/admin/agents', ag), (r) => tok(ag.name, r.token)); }}>
          <label className="sr" htmlFor="a-name">Agent name</label>
          <input id="a-name" type="text" required pattern="[a-z0-9-]+" placeholder="Agent name (lowercase)" value={ag.name} onChange={(e) => setAg({ ...ag, name: e.target.value })} />
          <label className="sr" htmlFor="a-role">Agent role</label>
          <input id="a-role" type="text" required placeholder="Role" value={ag.role} onChange={(e) => setAg({ ...ag, role: e.target.value })} />
          <button className="btn primary" type="submit">Add agent</button>
        </form>
      </section>
    </main>
  );
}
