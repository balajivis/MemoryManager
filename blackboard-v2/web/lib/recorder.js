'use client';
import { useEffect, useRef, useState } from 'react';

export const MAX_MS = 120000;

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
  }
  return null;
}
export const canRecord = () => typeof window !== 'undefined' && !!(navigator.mediaDevices && pickMime());

// Ask for the microphone at Talk tap time (so the prompt never eats the 15 s window),
// then release it. Resolves true when allowed.
export async function primeMic() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch { return false; }
}

// Records only between start() and finish()/discard(). Never posts by itself.
export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const r = useRef({});

  const cleanup = () => {
    const s = r.current;
    clearInterval(s.timer);
    if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
    if (s.ctx) { try { s.ctx.close(); } catch {} }
    r.current = {};
    setRecording(false); setLevel(0);
  };
  useEffect(() => cleanup, []);

  // onCap fires once at capMs (default 2 min).
  async function start(onCap, capMs = MAX_MS) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const rec = new MediaRecorder(stream, { mimeType: mime });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      let analyser = null, ctx = null, buf = null;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = ctx.createAnalyser(); analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
        buf = new Uint8Array(analyser.fftSize);
      } catch {}
      const t0 = Date.now(); let capped = false;
      const timer = setInterval(() => {
        const ms = Date.now() - t0;
        setElapsed(ms);
        if (analyser) { analyser.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); setLevel(Math.min(1, m / 80)); }
        if (!capped && ms >= capMs) { capped = true; if (onCap) onCap(); }
      }, 150);
      r.current = { rec, chunks, stream, timer, t0, ctx, mime };
      rec.start(1000);
      setElapsed(0); setRecording(true);
      return { ok: true };
    } catch (e) {
      return { ok: false, denied: e && (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'NotFoundError') };
    }
  }

  // Stop; resolves {blob, ms, mime} or null (discard).
  function end(keep) {
    return new Promise((resolve) => {
      const s = r.current;
      if (!s.rec) return resolve(null);
      const ms = Math.min(MAX_MS, Date.now() - s.t0);
      const type = (s.mime || 'audio/webm').split(';')[0];
      s.rec.onstop = () => {
        const out = keep ? { blob: new Blob(s.chunks, { type }), ms, mime: type } : null;
        cleanup(); resolve(out);
      };
      try { s.rec.stop(); } catch { cleanup(); resolve(null); }
    });
  }
  return { recording, elapsed, level, start, finish: () => end(true), discard: () => end(false) };
}
