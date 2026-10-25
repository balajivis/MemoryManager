'use client';
import { useState } from 'react';
import { api } from '../lib/api';
import { ago, text } from '../lib/util';

export const STAGES = ['claimed', 'built', 'tested', 'pr', 'merged', 'live'];
const STAGE_LABEL = { claimed: 'claimed', built: 'built', tested: 'tested', pr: 'PR', merged: 'merged', live: 'live' };
const STATUS_LABEL = { working: 'Working', waiting: 'Needs a human', blocked: 'Blocked' };
const STATUS_CHIP = { working: 'info', waiting: 'attn', blocked: 'block' };

function Item({ it, patch }) {
  const idx = STAGES.indexOf(it.stage);
  const status = STATUS_LABEL[it.status] ? it.status : it.needed ? 'waiting' : 'working';
  const [needed, setNeeded] = useState(it.needed || '');
  const [asking, setAsking] = useState(null);
  const setStatus = (s) => {
    if (s === 'working') return patch(it.id, { status: s, needed: '' });
    setAsking(s);
  };
  return (
    <li>
      <div>
        <div className="i-title"><a href={"#item=" + it.id}>{it.title}</a></div>
        <div className="i-meta">
          <span className={'chip ' + STATUS_CHIP[status]}>{STATUS_LABEL[status] || status}</span>
          <span>{it.owner ? 'Owner: ' + it.owner : 'No owner'}</span>
        </div>
        {it.needed && <div className="needed">Needed: {it.needed}</div>}
      </div>
      <div className="i-act">
        <button className="btn small" disabled={idx <= 0} onClick={() => patch(it.id, { stage: STAGES[idx - 1] })} aria-label={'Move "' + it.title + '" back a stage'}>◀</button>
        <button className="btn small" disabled={idx >= STAGES.length - 1} onClick={() => patch(it.id, { stage: STAGES[idx + 1] })} aria-label={'Move "' + it.title + '" forward a stage'}>▶</button>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={'Status of ' + it.title}>
          {Object.keys(STATUS_LABEL).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
        </select>
      </div>
      <div className="steps" role="img" aria-label={'Stage: ' + STAGE_LABEL[it.stage]}>
        {STAGES.map((s, i) => <span key={s} className={i <= idx ? (i === idx && status === 'waiting' ? 'wait' : i === idx && status === 'blocked' ? 'blk' : 'on') : ''} />)}
      </div>
      <div className="step-labels" aria-hidden="true">{STAGES.map((s) => <span key={s}>{STAGE_LABEL[s]}</span>)}</div>
      {asking && (
        <form className="needed-form" onSubmit={(e) => { e.preventDefault(); patch(it.id, { status: asking, needed }); setAsking(null); }}>
          <label className="sr" htmlFor={'need-' + it.id}>What is needed</label>
          <input id={'need-' + it.id} type="text" autoFocus value={needed} onChange={(e) => setNeeded(e.target.value)} placeholder="Needed: e.g. approve the privacy policy text" maxLength={200} required />
          <button className="btn primary small" type="submit">Save</button>
          <button className="btn small" type="button" onClick={() => setAsking(null)}>Cancel</button>
        </form>
      )}
    </li>
  );
}

export function Team({ board, online }) {
  if (!board) return null;
  const roster = (board.roster || []).map((r) => (typeof r === 'string' ? { name: r } : r));
  return (
      <section className="panel" aria-labelledby="h-team">
    <div className="panel-head"><h2 id="h-team">Team</h2><span className="hint">{roster.filter((r) => r.online || online.includes(r.name)).length} online</span></div>
    <ul className="roster">
      {roster.map((r) => {
        const on = r.online || online.includes(r.name);
        return (
          <li key={r.name}>
            <div className="bot" aria-hidden="true">{r.kind === 'human' || r.role === 'admin' || r.role === 'member' ? r.name.slice(0, 2).toUpperCase() : 'AI'}</div>
            <div><div className="r-name">{r.name}</div><div className="r-doing">{r.role}</div></div>
            <span className={'chip ' + (on ? 'ok' : 'idle')}>{on ? 'online' : 'offline'}</span>
          </li>);
      })}
    </ul>
  </section>
  );
}

export default function Board({ me, board, setBoard, online }) {
  const [title, setTitle] = useState('');
  const [dir, setDir] = useState('');
  const [strat, setStrat] = useState('');
  const [err, setErr] = useState('');
  if (!board) return <p className="empty">Loading board…</p>;

  const items = board.items || [];
  const open = items.filter((i) => i.stage !== 'live');
  const live = items.filter((i) => i.stage === 'live');
  // Backend: status is free text; "needs a human" = non-empty needed on an open item.
  const blocked = open.filter((i) => i.status === 'blocked');
  const waiting = open.filter((i) => i.status !== 'blocked' && (i.status === 'waiting' || i.needed));
  const attn = [...blocked, ...waiting];
  const directive = board.directive, strategy = board.strategy;

  async function run(fn) { setErr(''); try { await fn(); const b = await api('GET', '/board'); setBoard(b); } catch (e) { setErr(e.message); } }
  const patch = (id, body) => run(() => api('PATCH', '/items/' + id, body));
  const addItem = (e) => { e.preventDefault(); if (!title.trim()) return; run(async () => { await api('POST', '/items', { title: title.trim(), stage: 'claimed', status: 'working', needed: '', owner: me.name }); setTitle(''); }); };
  const saveDir = (t) => run(() => api('PUT', '/board/directive', { text: t }));
  const saveStrat = (e) => { e.preventDefault(); run(async () => { await api('PUT', '/board/strategy', { text: strat }); setStrat(''); }); };

  const attnPanel = (
    <section className="panel" aria-labelledby="h-attn" id="sec-attn" key="attn">
      <div className="panel-head"><h2 id="h-attn">Needs a human</h2><a className="hint" href="#tile=blocked">Blocked first · details</a></div>
      {attn.length === 0 ? <div className="empty">Nothing is waiting on a human.</div> : (
        <ul className="attn-list">
          {attn.map((i) => (
            <li key={i.id}><span className={'sev ' + (i.status === 'blocked' ? 'block' : '')} />
              <div><div className="i-title"><a href={"#item=" + i.id}>{i.title}</a></div>
                <div className="needed">Needed: {i.needed || '(not said)'}</div>
                <div className="i-meta"><span className={'chip ' + (i.status === 'blocked' ? 'block' : 'attn')}>{i.status === 'blocked' ? 'Blocked' : 'Needs a human'}</span><span>{i.owner}</span></div></div></li>
          ))}
        </ul>)}
    </section>
  );
  const wipPanel = (
    <section className="panel" aria-labelledby="h-wip" id="sec-wip" key="wip">
      <div className="panel-head"><h2 id="h-wip">Work items in progress</h2><a className="hint" href="#tile=in_progress">claimed → … → live · details</a></div>
      {open.length === 0 ? <div className="empty">No open work items.</div> : <ul className="items">{open.map((i) => <Item key={i.id + ':' + i.stage + i.status + (i.needed || '')} it={i} patch={patch} />)}</ul>}
      <form className="inline" onSubmit={addItem}>
        <label className="sr" htmlFor="item-title">New work item</label>
        <input id="item-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New work item" maxLength={140} />
        <button className="btn primary" type="submit">Add item</button>
      </form>
    </section>
  );

  return (
    <>
      {err && <p className="notice" data-kind="error" role="alert">{err}</p>}
      {text(directive) && (
        <div className="directive-banner"><span className="k">Directive · pinned</span><span>{text(directive)}</span>
          {typeof directive === 'object' && <span className="note">{directive.by ? 'by ' + directive.by : ''} {directive.at ? ago(directive.at) : ''}</span>}</div>
      )}
      <div className="summary" role="list" aria-label="Board summary">
        <a className="stat block" role="listitem" href="#tile=blocked"><span className="n">{blocked.length}</span><span className="k">Blocked</span></a>
        <a className="stat attn" role="listitem" href="#tile=blocked"><span className="n">{waiting.length}</span><span className="k">Needs a human</span></a>
        <a className="stat" role="listitem" href="#tile=in_progress"><span className="n">{open.length}</span><span className="k">Open</span></a>
        <a className="stat ok" role="listitem" href="#tile=delivered"><span className="n">{live.length}</span><span className="k">Delivered</span></a>
      </div>

      {attn.length ? [attnPanel, wipPanel] : [wipPanel, attnPanel]}

      <section className="panel" aria-labelledby="h-feat">
        <div className="panel-head"><h2 id="h-feat">Features delivered</h2><a className="hint" href="#tile=delivered">Items that reached live · details</a></div>
        {live.length === 0 ? <div className="empty">Nothing delivered yet.</div> : (
          <div className="features">{live.map((i) => <div className="feat" key={i.id}><a className="f-name" href={"#item=" + i.id}>{i.title}</a><span className="f-meta">{i.owner}</span></div>)}</div>)}
      </section>

      <div className="dock">
        <section className="panel" aria-labelledby="h-dir">
          <div className="panel-head"><h2 id="h-dir">Directive</h2><span className="hint">Pinned for everyone until cleared</span></div>
          <form onSubmit={(e) => { e.preventDefault(); saveDir(dir); setDir(''); }}>
            <label htmlFor="dir-text" className="note">Tell the team, agents included, what to do next.</label>
            <textarea id="dir-text" rows={3} maxLength={600} value={dir} onChange={(e) => setDir(e.target.value)} />
            <div className="row"><span /><span className="row">
              <button className="btn" type="button" onClick={() => saveDir('')}>Clear</button>
              <button className="btn primary" type="submit" disabled={!dir.trim()}>Pin directive</button></span></div>
          </form>
        </section>
        <section className="panel" aria-labelledby="h-strat">
          <div className="panel-head"><h2 id="h-strat">Strategy update</h2><span className="hint">{strategy && typeof strategy === 'object' && strategy.by ? 'by ' + strategy.by + ' ' + ago(strategy.at) : ''}</span></div>
          <p className="strategy-text">{text(strategy) || 'No strategy written yet.'}</p>
          <form onSubmit={saveStrat}>
            <label htmlFor="strat-input" className="note">Update the strategy. The previous version is replaced.</label>
            <textarea id="strat-input" rows={3} maxLength={1500} value={strat} onChange={(e) => setStrat(e.target.value)} />
            <div className="row"><span /><button className="btn" type="submit" disabled={!strat.trim()}>Save strategy</button></div>
          </form>
        </section>
      </div>
    </>
  );
}
