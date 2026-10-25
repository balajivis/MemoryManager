'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useRecorder, primeMic, canRecord, MAX_MS } from '../lib/recorder';
import { hold } from '../lib/playback';
import { useNow, mmss, chime, toMs } from '../lib/util';

const NOTES = {
  skipped_timeout: "You missed your turn, so you've moved to the back of the line.",
  admin_skip: "The admin ended your turn. Your recording wasn't sent.",
  disconnect: "You were disconnected, so you lost your place.",
  admin_clear: 'The admin cleared the line.',
};
const MIC_BLOCKED = 'Your microphone is blocked. Allow it in your browser’s site settings, then tap Talk again.';

// Global floor bar: the Talk / queue state machine S0-S7 (docs/ux/blackboard-v2-screens.md section 1).
export default function FloorBar({ me, floor, setFloor, floorEvent, settings }) {
  const rec = useRecorder();
  const [phase, setPhase] = useState('idle');   // idle | requesting | sending | failed
  const [notice, setNotice] = useState('');
  const [alertMsg, setAlertMsg] = useState('');
  const [failed, setFailed] = useState(null);   // {blob, ms, mime, url, err}
  const [listOpen, setListOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const supported = typeof window === 'undefined' ? true : canRecord();
  const isAdmin = me.role === 'admin';

  const { holder, queue = [], pending } = floor;
  const iHold = !!holder && holder.userId === me.id;
  const myPos = queue.findIndex((q) => q.userId === me.id);
  const myTurn = !!pending && pending.userId === me.id;
  const busy = !!holder || (!!pending && !myTurn);
  const active = !!holder || !!pending || rec.recording;
  const now = useNow(active);
  const left = myTurn ? Math.max(0, Math.ceil((toMs(pending.expiresAt) - now) / 1000)) : 0;

  const sendRef = useRef(); const wasTurn = useRef(false); const failedRef = useRef(null);
  failedRef.current = failed;

  // Playback lane pauses during S4-S7.
  useEffect(() => { hold(myTurn || rec.recording || phase === 'sending' || phase === 'failed'); },
    [myTurn, rec.recording, phase]);
  useEffect(() => () => hold(false), []);

  // Your turn: tab title, chime, assertive alert, 15 s / 5 s countdown announcements.
  useEffect(() => {
    if (myTurn && !wasTurn.current) { if (settings.chime) chime(); setAlertMsg("It's your turn to talk."); }
    if (!myTurn && wasTurn.current) setAlertMsg('');
    wasTurn.current = myTurn;
    const old = document.title;
    if (myTurn) document.title = '● Your turn · Team board';
    return () => { document.title = old; };
  }, [myTurn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (myTurn && (left === 15 || left === 5)) setAlertMsg(left + ' seconds left to start.'); }, [left, myTurn]);

  // Server told us why the floor changed.
  useEffect(() => {
    if (!floorEvent || floorEvent.userId !== me.id) return;
    const t = NOTES[floorEvent.reason];
    if (t) setNotice(t);
  }, [floorEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lost the floor while recording: drop the audio.
  useEffect(() => {
    if (rec.recording && !iHold) { rec.discard(); setNotice((n) => n || "Your turn ended. Your recording wasn't sent."); }
  }, [iHold, rec.recording]); // eslint-disable-line react-hooks/exhaustive-deps

  async function post(path, body) {
    try { const r = await api('POST', path, body); if (r && r.state) setFloor(r.state); return r; }
    catch (e) { setNotice(e.message); return null; }
  }
  function capFor(h) { return h && h.deadline ? Math.max(5000, Math.min(MAX_MS, toMs(h.deadline) - Date.now() - 1500)) : MAX_MS; }

  async function beginRecording(h) {
    const r = await rec.start(() => sendRef.current && sendRef.current(true), capFor(h));
    if (!r.ok) { setNotice(MIC_BLOCKED); await post('/voice/floor/leave'); }
  }
  async function talk() {
    setNotice(''); setPhase('requesting');
    if (!(await primeMic())) { setNotice(MIC_BLOCKED); setPhase('idle'); return; }
    const r = await post('/voice/floor/request');
    setPhase('idle');
    const h = r && r.state && r.state.holder;
    if (h && h.userId === me.id) await beginRecording(h);   // S0 -> S5 in one tap
  }
  async function startTurn() {
    setNotice('');
    const r = await post('/voice/floor/start');
    if (r && r.state) await beginRecording(r.state.holder);
  }
  async function upload(out) {
    setPhase('sending'); setNotice('');
    try {
      await api('POST', '/voice/notes', undefined, { raw: out.blob, headers: { 'Content-Type': out.mime, 'X-Duration-Ms': String(out.ms) } });
      if (failedRef.current) URL.revokeObjectURL(failedRef.current.url);
      setFailed(null); setPhase('idle');
      return true;
    } catch (e) {
      setFailed({ ...out, url: failedRef.current ? failedRef.current.url : URL.createObjectURL(out.blob), err: e.message });
      setPhase('failed');
      return false;
    }
  }
  sendRef.current = async (auto) => {
    const out = await rec.finish();
    if (!out) return;
    const ok = await upload(out);
    if (ok && auto) setNotice('Reached the 2-minute limit, so your note was sent.');
  };
  async function discardFailed() {
    if (failed) URL.revokeObjectURL(failed.url);
    setFailed(null); setPhase('idle');
    await post('/voice/floor/leave');
  }
  async function cancel() { await rec.discard(); await post('/voice/floor/leave'); }

  // Which of S0-S7
  let st = 'S0';
  if (phase === 'failed') st = 'S7';
  else if (phase === 'sending') st = 'S6';
  else if (rec.recording) st = 'S5';
  else if (myTurn) st = 'S4';
  else if (phase === 'requesting') st = 'S2';
  else if (myPos >= 0) st = 'S3';
  else if (busy) st = 'S1';

  const names = queue.filter((q) => q.userId !== me.id).map((q) => q.name);
  const nextTxt = names.length ? 'Next: ' + names.slice(0, 2).join(', ') + (names.length > 2 ? ' +' + (names.length - 2) : '') : '';
  const elapsed = rec.elapsed;
  const speaking = holder && !iHold ? holder.name + ' is talking · ' + mmss(now - toMs(holder.grantedAt)) : '';

  let line;
  if (st === 'S5') line = "You're talking · " + mmss(elapsed) + ' / ' + mmss(MAX_MS);
  else if (st === 'S6') line = 'Sending your note…';
  else if (st === 'S7') line = "Couldn't send your note.";
  else if (st === 'S4') line = "It's your turn to talk.";
  else if (st === 'S3') line = speaking ? speaking : 'The next speaker is getting ready.';
  else if (speaking) line = speaking;
  else if (pending && !myTurn) line = 'The next speaker is getting ready.';
  else line = 'The floor is free.';

  const place = queue.length + 1 + (pending && !myTurn ? 1 : 0);
  return (
    <section className="floorbar" data-st={st} aria-label="Voice floor">
      <div className="fb-row">
        <div className="fb-info">
          <p className="fb-line"><span className={'fb-dot' + (holder || myTurn ? ' on' : '')} aria-hidden="true" />
            {(holder && !iHold) || st === 'S3' ? <span aria-hidden="true">🎙 </span> : null}{line}</p>
          {st === 'S3' && <p className="fb-sub">You&apos;re <strong>#{myPos + 1}</strong> in line. We&apos;ll alert you when it&apos;s your turn.</p>}
          {queue.length > 0 && st !== 'S3' && (
            <button className="linkish" aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>{nextTxt || 'Show the line'}</button>)}
          {st === 'S3' && <button className="linkish" aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>Show the line</button>}
        </div>

        <div className="fb-ctl">
          {!supported && <span className="note">Voice notes aren&apos;t supported in this browser. You can still read and play them.</span>}
          {supported && (st === 'S0' || st === 'S1') && (
            <button className="btn primary talk" onClick={talk}>🎙 Talk{st === 'S1' && <small>You&apos;ll be #{place} in line</small>}</button>)}
          {st === 'S2' && <button className="btn primary talk" disabled>Asking for the floor…</button>}
          {st === 'S3' && <button className="btn" onClick={() => post('/voice/floor/leave')}>Leave the line</button>}
          {st === 'S4' && (<>
            <div className="ring" style={{ '--p': Math.min(100, (left / 15) * 100) + '%' }} aria-hidden="true"><span className="mono">{left}</span></div>
            <button className="btn primary talk" onClick={startTurn}>Start recording<small>Start within 0:{String(left).padStart(2, '0')}</small></button>
            <button className="btn" onClick={() => post('/voice/floor/leave')}>Pass</button>
          </>)}
          {st === 'S5' && (<>
            <span className="rec-dot" aria-hidden="true" />
            <span className={'mono rec-time' + (elapsed >= MAX_MS - 15000 ? ' warn' : '')}>{mmss(elapsed)} / {mmss(MAX_MS)}{elapsed >= MAX_MS - 15000 ? ' · 15 s left' : ''}</span>
            <span className="meter" aria-hidden="true"><i style={{ width: Math.round(rec.level * 100) + '%' }} /></span>
            <button className="btn primary" onClick={() => sendRef.current(false)}>Stop and send</button>
            <button className="btn" onClick={cancel}>Cancel</button>
          </>)}
          {st === 'S6' && <button className="btn primary" disabled>Sending…</button>}
          {st === 'S7' && (<>
            <button className="btn primary" onClick={() => upload(failed)}>Try again</button>
            <button className="btn" onClick={discardFailed}>Discard</button>
            {failed && <a className="btn" href={failed.url} download={'voice-note.' + (failed.mime === 'audio/mp4' ? 'm4a' : 'webm')}>Save a copy</a>}
          </>)}
        </div>
      </div>

      {st === 'S7' && failed && <p className="notice" data-kind="error">{failed.err}. The floor is held for 20 seconds, then released.</p>}
      {notice && <p className="notice" role="status">{notice} <button className="linkish" onClick={() => setNotice('')}>Dismiss</button></p>}
      {st === 'S4' && <div className="turn-banner" role="presentation">It&apos;s your turn to talk.</div>}
      <span className="sr" role="alert" aria-live="assertive">{alertMsg}</span>
      <span className="sr" role="status" aria-live="polite">{speaking || (st === 'S3' ? "You're number " + (myPos + 1) + ' in line.' : '')}</span>

      {listOpen && queue.length > 0 && (
        <ol className="queue" aria-label="The line">
          {queue.map((q, i) => (
            <li key={q.userId}><span className="mono">#{i + 1}</span> {q.name}{q.userId === me.id ? ' (you)' : ''}
              {isAdmin && <button className="btn small" aria-label={'Remove ' + q.name + ' from the line'} onClick={() => post('/voice/floor/skip', { userId: q.userId })}>×</button>}</li>))}
        </ol>)}

      {isAdmin && (holder || pending || queue.length > 0) && (
        <div className="fb-admin">
          <span className="chip agent">admin</span>
          {(holder || pending) && confirm !== 'skip' && <button className="btn small" onClick={() => setConfirm('skip')}>Skip</button>}
          {confirm === 'skip' && <span>Skip {holder ? holder.name : 'the next speaker'}? Their recording won&apos;t be sent.{' '}
            <button className="btn small primary" onClick={() => { post('/voice/floor/skip', {}); setConfirm(null); }}>Skip</button>{' '}
            <button className="btn small" onClick={() => setConfirm(null)}>Cancel</button></span>}
          {queue.length > 0 && confirm !== 'clear' && <button className="btn small" onClick={() => setConfirm('clear')}>Clear the line</button>}
          {confirm === 'clear' && <span>Remove everyone from the line?{' '}
            <button className="btn small primary" onClick={() => { post('/voice/floor/clear'); setConfirm(null); }}>Clear</button>{' '}
            <button className="btn small" onClick={() => setConfirm(null)}>Cancel</button></span>}
        </div>)}
    </section>
  );
}
