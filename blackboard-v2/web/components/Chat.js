'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, audioUrl } from '../lib/api';
import { enqueue, claimElement, subscribe, stopAll } from '../lib/playback';
import { clock, Mentions } from '../lib/util';

function VoiceNote({ id, live, who, speed }) {
  const [more, setMore] = useState(false);
  const au = useRef(null);
  useEffect(() => { if (au.current) au.current.playbackRate = speed; }, [speed]);
  const [info, setInfo] = useState(null);
  useEffect(() => { api('GET', '/voice/notes/' + id).then(setInfo).catch(() => {}); }, [id]);
  const v = { ...(info || {}), ...(live || {}) };
  const status = v.status || 'pending';
  const labels = { pending: 'Transcribing…', failed: 'Transcript unavailable.', disabled: 'Transcript unavailable.' };
  return (
    <div className="voice">
      <audio controls preload="none" src={audioUrl(id)} aria-label="Voice note"
        ref={au} onPlay={(e) => { e.currentTarget.playbackRate = speed; claimElement(e.currentTarget, who + '\u2019s note'); }} />
      <div className="transcript" data-status={status}>
        {status === 'done' ? <><span className={'tr-text' + (more ? '' : ' clamp')}>{v.transcript}</span>{(v.transcript || '').length > 160 && <button className="linkish" onClick={() => setMore(!more)}>{more ? 'Show less' : 'Show more'}</button>}</> : <span className="note">{labels[status] || status}</span>}
      </div>
    </div>
  );
}

export default function Chat({ me, chat, hasOlder, loadOlder, voice, settings }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [playing, setPlaying] = useState({});
  const listRef = useRef(null);
  const stick = useRef(true);
  const [announce, setAnnounce] = useState('');
  const seen = useRef(0);

  useEffect(() => subscribe(setPlaying), []);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat]);
  useEffect(() => {
    if (seen.current && chat.length > seen.current) {
      const m = chat[chat.length - 1];
      if (m.author !== me.name) setAnnounce(m.author + ': ' + (m.text || 'voice note').slice(0, 80));
    }
    seen.current = chat.length;
  }, [chat, me.name]);

  const onScroll = (e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };

  async function send(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setErr('');
    try { await api('POST', '/chat', { text: t }); setText(''); stick.current = true; } catch (x) { setErr(x.message); }
  }
  const speak = (m) => enqueue({ kind: 'speech', text: m.author + ' says: ' + m.text, label: m.author });
  const older = async () => { stick.current = false; await loadOlder(); };

  return (
    <section className="panel chat" aria-labelledby="h-chat">
      <div className="panel-head"><h2 id="h-chat">Team chat</h2><span className="hint">@mention an agent to bring it in</span></div>
      {playing.playing && (
        <div className="nowplaying" role="status">
          <span>▶ {playing.held ? 'Paused while you talk' : (playing.label || 'Playing')}{playing.waiting ? ' · ' + playing.waiting + ' more queued' : ''}</span>
          <button className="btn small" onClick={stopAll}>Stop all</button>
        </div>)}
      <ul className="msgs" ref={listRef} onScroll={onScroll} tabIndex={0} aria-label="Messages">
        {hasOlder && <li className="older"><button className="btn small" onClick={older}>Load older</button></li>}
        {chat.length === 0 && <li className="empty">No messages yet. Say hello, or @mention an agent.</li>}
        {chat.map((m) => (
          <li key={m.id} className={'msg ' + (m.author_kind === 'agent' ? 'agent' : '')}>
            <div className="bot" aria-hidden="true">{m.author_kind === 'agent' ? 'AI' : (m.author || '?').slice(0, 2).toUpperCase()}</div>
            <div>
              <div className="m-head">
                <span className="m-name">{m.author}</span>
                {m.author_kind === 'agent' && <span className="chip agent">agent</span>}
                <span className="m-time">{clock(m.created_at)}</span>
                {m.text && typeof window !== 'undefined' && 'speechSynthesis' in window && <button className="icon-btn" onClick={() => speak(m)} aria-label={'Read message from ' + m.author + ' aloud'} title="Read aloud">🔊</button>}
              </div>
              {m.text && <div className="m-text"><Mentions text={m.text} me={me.name} /></div>}
              {m.voice_note_id && <VoiceNote id={m.voice_note_id} live={voice[m.voice_note_id]} who={m.author} speed={settings.speed} />}
            </div>
          </li>
        ))}
      </ul>
      <span className="sr" role="status" aria-live="polite">{announce}</span>
      <form className="composer" onSubmit={send}>
        <div className="row">
          <label className="sr" htmlFor="chat-input">Message the team</label>
          <input id="chat-input" type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the team" maxLength={2000} autoComplete="off" />
          <button className="btn primary" type="submit">Send</button>
        </div>
        {err && <span className="notice" data-kind="error" role="alert">{err}</span>}
      </form>
    </section>
  );
}
