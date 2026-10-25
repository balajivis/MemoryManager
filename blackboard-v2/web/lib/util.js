'use client';
import { useEffect, useState } from 'react';

export function useNow(active = true, ms = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

export function mmss(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

export function clock(iso) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}
export function ago(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  if (m < 1440) return Math.round(m / 60) + ' h ago';
  return new Date(iso).toLocaleDateString();
}

// Known display names (roster + agents); longest first so "@UX Reviewer" beats "@UX".
let mentionNames = [];
export function setMentionNames(list) {
  mentionNames = (list || []).map((r) => (typeof r === 'string' ? r : r && r.name)).filter(Boolean)
    .sort((x, y) => y.length - x.length);
}
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Wrap @mentions in <span class="mention">; mine gets extra emphasis.
export function Mentions({ text, me }) {
  const alt = mentionNames.map(esc).concat('[a-z0-9-]+').join('|');
  const re = new RegExp('(@(?:' + alt + ')(?![a-z0-9-]))', 'gi');
  return String(text || '').split(re).map((p, i) => {
    if (i % 2 === 1) {
      const mine = me && p.slice(1).toLowerCase() === String(me).toLowerCase();
      return <span key={i} className={'mention' + (mine ? ' me' : '')}>{p}</span>;
    }
    return p;
  });
}

export const STAGES = ['claimed', 'built', 'tested', 'pr', 'merged', 'live'];
export const STAGE_LABEL = { claimed: 'Claimed', built: 'Built', tested: 'Tested', pr: 'PR', merged: 'Merged', live: 'Live' };
export const STATUS_LABEL = { waiting: 'Needs a human', blocked: 'Blocked', working: 'Working', done: 'Done' };
export const label = (map, v) => map[v] || (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : '');
export function dayLabel(day) {
  const d = new Date(day + 'T12:00:00');
  return isNaN(d) ? day : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
}

export const text = (v) => (v && typeof v === 'object' ? v.text || '' : v || '');

export function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start();
    setTimeout(() => { o.frequency.value = 1175; }, 150);
    setTimeout(() => { o.stop(); ctx.close(); }, 320);
  } catch {}
}
export const toMs = (t) => (typeof t === 'number' ? t : new Date(t).getTime());
