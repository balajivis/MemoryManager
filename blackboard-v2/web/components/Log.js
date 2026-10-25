'use client';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ago, Mentions } from '../lib/util';

const KIND = { obs: 'idle', claim: 'info', done: 'ok', ask: 'attn', reply: 'idle', warn: 'block' };
const KINDS = ['obs', 'claim', 'done', 'ask', 'reply', 'warn'];
export const mentionsMe = (e, name) => new RegExp('@' + name + '(?![a-z0-9-])', 'i').test(e.text || '');

// Agent log: blackboard entries, newest at the bottom like chat.
export default function Log({ me, feed, loadOlder }) {
  const [mode, setMode] = useState('all');   // all | me
  const [agent, setAgent] = useState('');
  const [kind, setKind] = useState('');
  const ref = useRef(null); const stick = useRef(true);

  const agents = useMemo(() => [...new Set(feed.map((e) => e.author))].sort(), [feed]);
  const rows = useMemo(() => feed.filter((e) => (mode !== 'me' || mentionsMe(e, me.name)) && (!agent || e.author === agent) && (!kind || e.kind === kind)).slice().reverse(), [feed, mode, agent, kind, me.name]);

  useLayoutEffect(() => { const el = ref.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [rows]);
  const onScroll = (e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };

  return (
    <section className="panel" aria-labelledby="h-log">
      <div className="panel-head"><h2 id="h-log" className="sr">Agent log</h2><span className="hint">Blackboard entries, newest at the bottom</span></div>
      <div className="filters">
        <div role="group" aria-label="Show">
          <button className={'btn small' + (mode === 'all' ? ' primary' : '')} aria-pressed={mode === 'all'} onClick={() => setMode('all')}>All</button>{' '}
          <button className={'btn small' + (mode === 'me' ? ' primary' : '')} aria-pressed={mode === 'me'} onClick={() => setMode('me')}>Mentions me</button>
        </div>
        <label className="sr" htmlFor="f-agent">Agent</label>
        <select id="f-agent" value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">Any agent</option>{agents.map((a) => <option key={a}>{a}</option>)}</select>
        <label className="sr" htmlFor="f-kind">Kind</label>
        <select id="f-kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Any kind</option>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
      </div>
      <ul className="feed logbox" ref={ref} onScroll={onScroll} tabIndex={0} aria-label="Agent log entries">
        {feed.length >= 50 && <li className="older"><button className="btn small" onClick={() => { stick.current = false; loadOlder(); }}>Load older</button></li>}
        {rows.length === 0 && <li className="empty">No entries match.</li>}
        {rows.map((e) => (
          <li key={e.author + ':' + e.seq}>
            <div className="m-head">
              <span className={'chip ' + (KIND[e.kind] || 'idle')}>{e.kind}</span>
              <span className="m-name agent-name">{e.author}</span>
              <span className="m-time">{ago(e.created_at)}</span>
              {mentionsMe(e, me.name) && <span className="chip attn">mentions you</span>}
            </div>
            <div className="m-text"><Mentions text={e.text} me={me.name} /></div>
          </li>))}
      </ul>
    </section>
  );
}
