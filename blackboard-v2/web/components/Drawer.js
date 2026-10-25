'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { ago, clock, Mentions, text } from '../lib/util';

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

export function SummaryCard({ summaries }) {
  const s = summaries[0];
  return (
    <section className="panel" aria-labelledby="h-sum">
      <div className="panel-head"><h2 id="h-sum">Daily summary</h2><a className="hint" href="#summaries">Past days</a></div>
      {!s ? <div className="empty">No summary yet. The pm agent posts one each evening.</div> : (
        <a className="card-link" href={'#summary=' + s.day}>
          <span className="mono hint">{s.day}</span>
          <span className="sum-text">{s.text}</span>
          <span className="hint">{(s.done || []).length} done · {(s.blocked || []).length} blocked</span>
        </a>)}
    </section>
  );
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

function ItemRow({ it }) {
  return (
    <li className="d-item">
      <a className="i-title" href={'#item=' + it.id}>{it.title}</a>
      <div className="i-meta"><span className="chip info">{it.stage}</span>{it.status && <span className="chip idle">{it.status}</span>}
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

function Body({ h, me, summaries, board }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setData(null); setErr('');
    const path = h.k === 'tile' ? '/board/tiles/' + encodeURIComponent(h.v) : h.k === 'item' ? '/items/' + encodeURIComponent(h.v)
      : h.k === 'summary' ? '/summaries/' + encodeURIComponent(h.v) : null;
    if (!path) return;
    api('GET', path).then(setData).catch((e) => {
      if (e.status === 404 && h.k === 'tile') return setData(localTile(board, h.v));
      if (e.status === 404 && h.k === 'item') { const it = ((board && board.items) || []).find((i) => String(i.id) === h.v); if (it) return setData({ item: it, history: [], entries: [] }); }
      setErr(e.message);
    });
  }, [h.k, h.v]);

  if (h.k === 'summaries') return (
    <ul className="feed">{summaries.length === 0 && <li className="empty">No summaries yet.</li>}
      {summaries.map((s) => <li key={s.day}><a href={'#summary=' + s.day}><span className="mono">{s.day}</span></a> <span className="sum-text">{s.text}</span></li>)}</ul>);
  if (err) return <p className="notice" data-kind="error" role="alert">{err}</p>;
  if (!data) return <p className="note" role="status">Loading…</p>;

  if (h.k === 'tile') return (<>
    {data.items.length === 0 ? <p className="empty">Nothing here.</p> : <ul className="items d-items">{data.items.map((i) => <ItemRow key={i.id} it={i} />)}</ul>}
    <Entries entries={data.entries} me={me} />
  </>);
  if (h.k === 'item') {
    const it = data.item || data;
    return (<>
      <ul className="items d-items"><ItemRow it={it} /></ul>
      <h3>History</h3>
      {(data.history || it.history || []).length === 0 ? <p className="note">No history yet.</p> :
        <ul className="history">{(data.history || it.history).map((x, i) => <li key={i}><span className="mono">{clock(x.at)}</span> {x.stage} · {x.status}{x.by ? ' by ' + x.by : ''}</li>)}</ul>}
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
  const closeRef = useRef(null);
  const opener = useRef(null);
  const close = () => { history.pushState(null, '', window.location.pathname + window.location.search); window.dispatchEvent(new HashChangeEvent('hashchange')); };

  useEffect(() => {
    if (!h) { if (opener.current && opener.current.focus) opener.current.focus(); opener.current = null; return; }
    if (!opener.current) opener.current = document.activeElement;
    if (closeRef.current) closeRef.current.focus();
  }, [!!h]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!h) return null;
  const titles = { tile: { blocked: 'Blocked / Needs a human', in_progress: 'Open work', delivered: 'Delivered', live: 'Live', all: 'All items' }, item: 'Work item', summary: 'Summary ' + h.v, summaries: 'Daily summaries' };
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
        <div className="d-body"><Body h={h} me={me} summaries={summaries} board={board} /></div>
      </aside>
    </div>
  );
}
