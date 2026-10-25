'use client';
// UX polish helpers (owner: ux). Spec: docs/ux/blackboard-v2-screens.md §1 (S4 "your turn").
import { useEffect, useRef } from 'react';

let ctx = null;

// A soft two-note chime made with WebAudio, so there's no audio asset to ship. Quiet by design.
export function chime() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    [[659.25, 0], [880, 0.14]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.35);
    });
  } catch (e) { /* no audio available: the banner still shows */ }
}

// While `active` (it's my turn), chime once and prefix the tab title so a backgrounded tab still says so.
export function useTurnAlert(active, { sound = true } = {}) {
  const original = useRef(null);
  useEffect(() => {
    if (!active) return undefined;
    original.current = document.title;
    document.title = '● Your turn · ' + original.current;
    if (sound) chime();
    return () => { document.title = original.current; };
  }, [active, sound]);
}
