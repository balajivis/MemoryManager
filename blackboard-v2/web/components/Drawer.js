'use client';
import { Component, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { ago, clock, dayLabel, label, Mentions, STAGES, STAGE_LABEL, STATUS_LABEL, text } from '../lib/util';

// Hash routes: #tile=<key>  #item=<id>  #summaries  #summary=<day>
function parseHash() {
  const h = window.location.hash.replace(/^#/, '');
  const [k, v] = h.split('=');
  return ['tile', 'item', 'summary', 'summaries'].includes(k) ? { k, v: v || '' } : null;
}
function useHash() {
  const [h, setH] = useState(null);
  useEffect(() => {
    const f = () => setH(parseHash());
    f(); window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h;
}

const inline = (arr, f) => arr.map(f).join(' · ');
export function SummaryCard({ summaries }) {
  const s = summaries[0];
  const done = (s && s.done) || [], blocked = (s && s.blocked) || [];
  return (
    <section className="panel" aria-labelledby="h-sum">
      <div className="panel-head"><h2 id="h-sum">Daily summary{s ? ' · ' + dayLabel(s.day) : ''}</h2><a className="hint" href="#summaries">Past days</a></div>
      {!s ? <div className="empty">No summary yet. The pm agent posts one each evening.</div> : (
        <a className="card-link" href={'#summary=' + s.day}>
          <span className="sum-text">{s.text}</span>
          {done.length > 0 && <span className="hint"><b>Done</b> {inline(done, (d) => d.title)}</span>}
          {blocked.length > 0 && <span className="hint"><b>Needs a human</b> {inline(blocked, (d) => d.title + (d.needed ? ' (' + d.needed + ')' : ''))}</span>}
          {!done.length && !blocked.length && <span className="hint">Nothing done or waiting.</span>}
        </a>)}
    </section>
  );
}

class Boundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    return this.state.err ? <p className="notice" data-kind="error" role="alert">This drawer could not be shown. Close it and try again.</p> : this.props.children;
  }
}

function StepBar({ it }) {
  const cur = STAGES.indexOf(it.stage);
  const cls = it.status === 'blocked' ? 'blk' : (it.status === 'waiting' || it.needed) ? 'wait' : 'on';
  return (<>
    <div className="steps" role="img" aria-label={'Step ' + (cur + 1) + ' of ' + STAGES.length + ': ' + label(STAGE_LABEL, it.stage)}>
      {STAGES.map((st, i) => <span key={st} className={i <= cur ? (i === cur ? cls : 'on') : ''} />)}</div>
    <div className="i-meta">{STAGES.map((st, i) => <span key={st} style={i === cur ? { fontWeight: 700 } : undefined}>{STAGE_LABEL[st]}</span>)}</div>
  </>);
}

function Entries({ entries, me }) {
  if (!entries || !entries.length) return null;
  return (<>
    <h3>Related entries</h3>
    <ul className="feed">{entries.map((e) => (
      <li key={e.author + ':' + e.seq}><div className="m-head"><span className="m-name agent-name">{e.author}</span><span className="chip idle">{e.kind}</span><span className="m-time">{ago(e.created_at)}</span></div>
        <div className="m-text"><Mentions text={e.text} me={me.name} /></div></li>))}</ul>
  </>);
}

function ItemRow({ it, plain }) {
  return (
    <li className="d-item">
      {plain ? <div className="i-title" style={{ color: 'inherit' }}>{it.title}</div> : <a className="i-title" href={'#item=' + it.id}>{it.title}</a>}
      <div className="i-meta"><span className="chip info">{label(STAGE_LABEL, it.stage)}</span>{it.status && <span className="chip idle">{label(STATUS_LABEL, it.status)}</span>}
        <span>{it.owner ? 'Owner: ' + it.owner : 'No owner'}</span>
        {it.updated_at && <span>updated {ago(it.updated_at)}</span>}{it.created_at && <span>created {ago(it.created_at)}</span>}</div>
      {it.needed && it.status !== 'working' && <div className="needed">Needed: {it.needed}</div>}
    </li>
  );
}

// Fallback when the tile/item routes are missing: derive from the board snapshot.
function localTile(board, key) {
  const items = (board && board.items) || [];
  const open = items.filter((i) => i.stage !== 'live');
  const pick = { blocked: open.filter((i) => i.status === 'blocked' || i.needed), in_progress: open, delivered: items.filter((i) => i.stage === 'live'), live: items.filter((i) => i.stage === 'live'), all: items }[key] || [];
  return { tile: key, items: pick, entries: [] };
}

function Body({ h, me, summaries, board, fromList }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setErr('');
    const path = h.k === 'tile' ? '/board/tiles/' + encodeURIComponent(h.v) : h.k === 'item' ? '/items/' + encodeURIComponent(h.v)
      : h.k === 'summary' ? '/summaries/' + encodeURIComponent(h.v) : null;
    if (!path) return;
    let live = true;
    api('GET', path).then((d) => live && setData(d)).catch((e) => {
      if (!live) return;
      if (e.status === 404 && h.k === 'tile') return setData(localTile(board, h.v));
      if (e.status === 404 && h.k === 'item') { const it = ((board && board.items) || []).find((i) => String(i.id) === h.v); if (it) return setData({ item: it, history: [], entries: [] }); }
      setErr(e.message);
    });
    return () => { live = false; };
  }, [h.k, h.v, tick]);

  if (h.k === 'summaries') return (
    <ul className="feed">{summaries.length === 0 && <li className="empty">No summaries yet.</li>}
      {summaries.map((s) => <li key={s.day}><a href={'#summary=' + s.day}><span className="mono">{s.day}</span></a> <span className="sum-text">{s.text}</span></li>)}</ul>);
  if (err) return <p className="notice" data-kind="error" role="alert">{err}</p>;
  if (!data) return <p className="note" role="status">Loading…</p>;

  if (h.k === 'tile') {
    const raw = data.items || [];
    const isB = (i) => i.status === 'blocked';
    const items = [...raw.filter(isB), ...raw.filter((i) => !isB(i))];
    return (<>
      {items.length === 0 ? <p className="empty">Nothing here.</p> : <ul className="items d-items">{items.map((i) => <ItemRow key={i.id} it={i} />)}</ul>}
      <Entries entries={data.entries} me={me} />
    </>);
  }
  if (h.k === 'item') {
    const it = data.item || data;
    const hist = data.history || it.history || [];
    const idx = STAGES.indexOf(it.stage);
    const go = (body) => api('PATCH', '/items/' + it.id, body).then(() => setTick((t) => t + 1)).catch((e) => setErr(e.message));
    return (<>
      {fromList && <p><a href="#back" onClick={(e) => { e.preventDefault(); history.back(); }}>‹ Back</a></p>}
      <ul className="items d-items"><ItemRow it={it} plain /></ul>
      <StepBar it={it} />
      <div className="row">
        <button className="btn small" disabled={idx <= 0} onClick={() => go({ stage: STAGES[idx - 1] })}>◀ Back a step</button>
        <button className="btn small" disabled={idx < 0 || idx >= STAGES.length - 1} onClick={() => go({ stage: STAGES[idx + 1] })}>Forward a step ▶</button>
        <button className="btn small" disabled={it.stage === 'live'} onClick={() => go({ stage: 'live' })}>Mark as live</button>
      </div>
      <h3>History</h3>
      {hist.length === 0 ? <p className="note">No history yet.</p> :
        <ul className="history">{hist.map((x, i) => <li key={i}><span className="mono">{clock(x.at)}</span> {label(STAGE_LABEL, x.stage)} · {label(STATUS_LABEL, x.status) || 'No status'}{x.by ? ' by ' + x.by : ''}</li>)}</ul>}
      <Entries entries={data.entries || it.entries} me={me} />
    </>);
  }
  // summary
  const s = data.summary || data;
  return (<>
    <p className="sum-text">{s.text}</p>
    {(s.done || []).length > 0 && <><h3>Done</h3><ul>{s.done.map((d, i) => <li key={i}>{d.title}{d.owner ? ' (' + d.owner + ')' : ''}</li>)}</ul></>}
    {(s.blocked || []).length > 0 && <><h3>Blocked</h3><ul>{s.blocked.map((d, i) => <li key={i}>{d.title}{d.needed ? ': needed ' + d.needed : ''}</li>)}</ul></>}
    <p><a href="#summaries">All days</a></p>
  </>);
}

export default function Drawer({ me, summaries, board }) {
  const h = useHash();
  const prev = useRef(null), cur = useRef(null);
  const key = h ? h.k + '=' + h.v : '';
  if (cur.current !== key) { prev.current = cur.current; cur.current = key; }
  const fromList = !!(h && h.k === 'item' && prev.current && prev.current.startsWith('tile='));
  const closeRef = useRef(null);
  const opener = useRef(null);
  const close = () => { history.pushState(null, '', window.location.pathname + window.location.search); window.dispatchEvent(new HashChangeEvent('hashchange')); };

  useEffect(() => {
    if (!h) { if (opener.current && opener.current.focus) opener.current.focus(); opener.current = null; return; }
    if (!opener.current) opener.current = document.activeElement;
    if (closeRef.current) closeRef.current.focus();
  }, [!!h]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!h) return null;
  const titles = { tile: { blocked: 'Blocked and needs a human', in_progress: 'Open work', delivered: 'Delivered', live: 'Live', all: 'All items' }, item: 'Work item', summary: 'Summary ' + dayLabel(h.v), summaries: 'Daily summaries' };
  const open = ((board && board.items) || []).filter((i) => i.stage !== 'live');
  const nb = open.filter((i) => i.status === 'blocked').length, nw = open.filter((i) => i.status !== 'blocked' && (i.status === 'waiting' || i.needed)).length;
  if (board) titles.tile.blocked = 'Blocked ' + nb + ' · Needs a human ' + nw;
  const title = h.k === 'tile' ? titles.tile[h.v] || h.v : titles[h.k];

  function onKey(e) {
    if (e.key === 'Escape') return close();
    if (e.key !== 'Tab') return;      // keep focus inside the dialog
    const f = e.currentTarget.querySelectorAll('a[href], button, input, select, textarea');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  return (
    <div className="scrim" onClick={close}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="d-title" onKeyDown={onKey} onClick={(e) => e.stopPropagation()}>
        <div className="panel-head"><h2 id="d-title">{title}</h2><button ref={closeRef} className="btn small" onClick={close}>Close</button></div>
        <div className="d-body"><Boundary key={key}><Body key={key} h={h} me={me} summaries={summaries} board={board} fromList={fromList} /></Boundary></div>
      </aside>
    </div>
  );
}
