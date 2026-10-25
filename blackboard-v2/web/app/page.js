'use client';
import { useEffect, useRef, useState } from 'react';
import { useLive } from '../lib/live';
import { api } from '../lib/api';
import { setMentionNames } from '../lib/util';
import Board, { Team } from '../components/Board';
import Chat from '../components/Chat';
import Log, { mentionsMe } from '../components/Log';
import FloorBar from '../components/FloorBar';
import Drawer, { SummaryCard } from '../components/Drawer';

const CONN = { live: 'Live', reconnecting: 'Reconnecting…', connecting: 'Connecting…' };

function Settings({ settings, setSetting, onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current && ref.current.focus(); }, []);
  const row = (k, label) => <label className="set-row"><input type="checkbox" checked={settings[k]} onChange={(e) => setSetting(k, e.target.checked)} /> {label}</label>;
  return (
    <div className="scrim center" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="set-t" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2 id="set-t">Settings</h2>
        {row('autoplay', 'Play new voice notes automatically')}
        {row('readAloud', 'Read agent replies aloud')}
        {row('chime', "Chime when it's my turn")}
        <label className="set-row"><input type="checkbox" checked={settings.speed === 1.5} onChange={(e) => setSetting('speed', e.target.checked ? 1.5 : 1)} /> Play voice notes at 1.5×</label>
        <p className="note">Saved in this browser.</p>
        <button ref={ref} className="btn primary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export default function Home() {
  const s = useLive();
  const [tab, setTab] = useState('chat');
  const [showSettings, setShowSettings] = useState(false);
  const [unread, setUnread] = useState({ chat: 0, log: 0 });
  const seen = useRef({ chat: null, log: null });
  const tabRef = useRef(tab); tabRef.current = tab;

  // Unread counts for the tab not in view.
  useEffect(() => {
    if (!s.me) return;
    const prev = seen.current.chat; seen.current.chat = s.chat.length;
    if (prev !== null && s.chat.length > prev && tabRef.current !== 'chat') setUnread((u) => ({ ...u, chat: u.chat + s.chat.length - prev }));
  }, [s.chat.length, s.me]);
  useEffect(() => {
    if (!s.me) return;
    const prev = seen.current.log; seen.current.log = s.feed[0] ? s.feed[0].author + s.feed[0].seq : '';
    const e = s.feed[0];
    if (prev !== null && e && prev !== e.author + e.seq && tabRef.current !== 'log') setUnread((u) => ({ ...u, log: u.log + 1 }));
  }, [s.feed, s.me]);
  useEffect(() => { if (tab === 'chat' || tab === 'log') setUnread((u) => ({ ...u, [tab]: 0 })); }, [tab]);

  if (!s.me) return <main className="wrap"><p className="empty" role="status">Loading…</p></main>;
  const admin = s.me.role === 'admin';
  const logout = async (all) => {
    try { await api('POST', all ? '/auth/logout-all' : '/auth/logout'); } catch {}
    window.location.assign('/board/login/');
  };
  const badge = (n) => (n > 0 ? <span className="badge" aria-label={n + ' unread'}>{n}</span> : null);
  const warnBadge = s.feed.slice(0, 20).some((e) => (e.kind === 'warn' || (e.kind === 'ask' && mentionsMe(e, s.me.name))) && tab !== 'log');
  // On desktop only chat|log apply to the right column; board/team are mobile panes.
  const desk = tab === 'log' ? 'log' : 'chat';
  setMentionNames([...(s.board && s.board.roster || []), s.me]);

  return (
    <main className="wrap" data-tab={tab} data-desk={desk}>
      <header className="top">
        <div className="brand"><h1>Team board</h1><span className="sub">Humans and agents, one board</span></div>
        <div className="top-r">
          <span className="status"><span className={'dot' + (s.conn === 'live' ? ' on' : '')} /> {CONN[s.conn]}</span>
          <details className="menu">
            <summary className="btn">{s.me.name} ▾</summary>
            <div className="menu-list">
              <button className="btn" onClick={() => setShowSettings(true)}>Settings</button>
              {admin && <a className="btn" href="/board/admin/#people">People and invites</a>}
              {admin && <a className="btn" href="/board/admin/#agents">Agents and tokens</a>}
              <button className="btn" onClick={() => logout(false)}>Log out</button>
              <button className="btn" onClick={() => logout(true)}>Log out of all devices</button>
            </div>
          </details>
        </div>
      </header>

      <FloorBar me={s.me} floor={s.floor} setFloor={s.setFloor} floorEvent={s.floorEvent} settings={s.settings} />

      <div className="main">
        <div className="col pane pane-board"><SummaryCard summaries={s.summaries} /><Board me={s.me} board={s.board} setBoard={s.setBoard} online={s.online} /></div>
        <div className="col">
          <div className="tabs-desk" role="tablist" aria-label="Chat or agent log">
            <button role="tab" aria-selected={desk === 'chat'} className="tab" onClick={() => setTab('chat')}>Chat {badge(unread.chat)}</button>
            <button role="tab" aria-selected={desk === 'log'} className="tab" onClick={() => setTab('log')}>Agent log {badge(unread.log)}{warnBadge && <span className="badge warn" aria-label="needs attention">!</span>}</button>
          </div>
          <div className="pane pane-chat"><Chat me={s.me} chat={s.chat} hasOlder={s.hasOlder} loadOlder={s.loadOlder} voice={s.voice} settings={s.settings} /></div>
          <div className="pane pane-log"><Log me={s.me} feed={s.feed} loadOlder={s.loadOlderFeed} /></div>
          <div className="pane pane-team"><Team board={s.board} online={s.online} /></div>
        </div>
      </div>

      <nav className="tabbar" aria-label="Sections">
        {[['chat', 'Chat'], ['board', 'Board'], ['log', 'Log'], ['team', 'Team']].map(([k, l]) => (
          <button key={k} className="tab" aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l} {k !== 'board' && k !== 'team' && badge(unread[k])}</button>))}
      </nav>
      <Drawer me={s.me} summaries={s.summaries} board={s.board} />
      {showSettings && <Settings settings={s.settings} setSetting={s.setSetting} onClose={() => setShowSettings(false)} />}
    </main>
  );
}
