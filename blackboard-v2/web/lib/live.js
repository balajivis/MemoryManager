'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { api, loadMe } from './api';
import { connectWs } from './ws';
import { enqueue, setRate } from './playback';

const EMPTY_FLOOR = { holder: null, queue: [], pending: null };

function pref(key, def) { try { const v = localStorage.getItem(key); return v === null ? def : v === '1'; } catch { return def; } }
function setPref(key, v) { try { localStorage.setItem(key, v ? '1' : '0'); } catch {} }

// All live state for the board page: one WS feeds chat, feed, board, floor, presence.
export function useLive() {
  const [me, setMe] = useState(null);
  const [conn, setConn] = useState('connecting');
  const [chat, setChat] = useState([]);         // oldest first
  const [hasOlder, setHasOlder] = useState(false);
  const [feed, setFeed] = useState([]);         // newest first
  const [board, setBoard] = useState(null);
  const [floor, setFloor] = useState(EMPTY_FLOOR);
  const [turn, setTurn] = useState(null);       // floor_turn {expiresAt}
  const [online, setOnline] = useState([]);
  const [summaries, setSummaries] = useState([]); // newest first
  const [voice, setVoice] = useState({});       // id -> {status, transcript}
  const [floorEvent, setFloorEvent] = useState(null); // {reason, userId, n}
  const [settings, setSettingsState] = useState({ autoplay: false, readAloud: false, chime: true, speed: 1 });
  const prefs = useRef(settings);

  useEffect(() => {
    const st = { autoplay: pref('bb.autoplay', false), readAloud: pref('bb.readAloud', false), chime: pref('bb.chime', true), speed: pref('bb.speed', false) ? 1.5 : 1 };
    prefs.current = st; setSettingsState(st); setRate(st.speed);
  }, []);
  const setSetting = (k, v) => {
    const st = { ...prefs.current, [k]: v };
    prefs.current = st; setSettingsState(st);
    if (k === 'speed') { setPref('bb.speed', v === 1.5); setRate(v); } else setPref('bb.' + k, v);
  };
  const meRef = useRef(null);

  const onMessage = useCallback((m) => {
    const u = meRef.current;
    switch (m.type) {
      case 'hello':
        if (m.floor) setFloor(m.floor);
        if (m.online) setOnline(m.online);
        break;
      case 'chat': {
        const msg = m.message;
        setChat((c) => (c.some((x) => x.id === msg.id) ? c : [...c, msg]));
        const mine = u && msg.author === u.name;
        if (!mine && msg.voice_note_id && prefs.current.autoplay) {
          enqueue({ kind: 'audio', url: '/board/api/voice/notes/' + msg.voice_note_id + '/audio', label: 'voice note from ' + msg.author });
        } else if (!mine && msg.author_kind === 'agent' && prefs.current.readAloud && msg.text) {
          enqueue({ kind: 'speech', text: msg.author + ' says: ' + msg.text, label: msg.author });
        }
        break;
      }
      case 'feed': setFeed((f) => [m.entry, ...f]); break;
      case 'board': setBoard(m.board); break;
      case 'floor': setFloor(m.state || EMPTY_FLOOR); setTurn(null); if (m.reason) setFloorEvent({ reason: m.reason, userId: m.userId, n: Date.now() }); break;
      case 'floor_turn': setTurn({ expiresAt: m.expiresAt }); break;
      case 'voice': setVoice((v) => ({ ...v, [m.id]: { status: m.status, transcript: m.transcript } })); break;
      case 'summary': setSummaries((l) => [m.summary, ...l.filter((x) => x.day !== m.summary.day)].sort((a, b) => (a.day < b.day ? 1 : -1))); break;
      case 'presence': setOnline(m.online || []); break;
    }
  }, []);

  useEffect(() => {
    let stop = null, dead = false;
    (async () => {
      const user = await loadMe();
      if (dead) return;
      meRef.current = user; setMe(user);
      const [c, f, b, sm] = await Promise.all([
        api('GET', '/chat?limit=50'), api('GET', '/bb/feed?limit=50'), api('GET', '/board'),
        api('GET', '/summaries?limit=14').catch(() => []),
      ]);
      if (dead) return;
      setChat(c.messages.slice().reverse()); setHasOlder(c.messages.length >= 50);
      setFeed(f.entries || f || []); setBoard(b); setSummaries(Array.isArray(sm) ? sm : (sm.summaries || []));
      stop = connectWs({ onMessage, onStatus: (s) => setConn(s === 'open' ? 'live' : 'reconnecting') });
    })().catch(() => {});
    return () => { dead = true; if (stop) stop(); };
  }, [onMessage]);

  const loadOlder = async () => {
    if (!chat.length) return;
    const c = await api('GET', '/chat?limit=50&before=' + chat[0].id);
    setChat((cur) => [...c.messages.slice().reverse(), ...cur]);
    setHasOlder(c.messages.length >= 50);
  };
  const loadOlderFeed = async () => {
    if (!feed.length) return;
    const f = await api('GET', '/bb/feed?limit=50&before=' + encodeURIComponent(feed[feed.length - 1].created_at));
    setFeed((cur) => [...cur, ...(f.entries || f || [])]);
  };

  return { me, conn, chat, hasOlder, loadOlder, feed, loadOlderFeed, board, setBoard, floor, setFloor, turn, online, voice, summaries,
    settings, setSetting, floorEvent };
}
