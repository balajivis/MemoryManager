// One sequential playback lane. New voice notes, read-aloud speech and manual
// plays of a note's <audio> element all go through here, so two never overlap.
// hold(true) pauses the lane (while the user is in the talk flow); hold(false) resumes.
let queue = [];
let current = null;      // { label, stop(), pause(), resume(), done? }
let running = false;
let held = false;
let rate = 1;
const listeners = new Set();

function emit() { listeners.forEach((f) => f({ playing: !!current || queue.length > 0, label: current ? current.label : '', waiting: queue.length, held })); }
export function subscribe(f) { listeners.add(f); return () => listeners.delete(f); }
export function setRate(r) { rate = r; }

function playAudio(item) {
  const a = new Audio(item.url);
  a.playbackRate = rate;
  return new Promise((resolve) => {
    current = { label: item.label || 'voice note', stop: () => { a.pause(); resolve(); }, pause: () => a.pause(), resume: () => a.play().catch(resolve) };
    a.onended = a.onerror = () => resolve();
    if (!held) a.play().catch(() => resolve()); // autoplay blocked or failed: skip
  });
}
function playSpeech(item) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    const u = new SpeechSynthesisUtterance(item.text);
    current = { label: item.label || 'message', stop: () => { speechSynthesis.cancel(); resolve(); }, pause: () => speechSynthesis.pause(), resume: () => speechSynthesis.resume() };
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
    if (held) speechSynthesis.pause();
  });
}

async function run() {
  if (running) return;
  running = true;
  while (queue.length) {
    while ((current && current.done) || held) await new Promise((r) => setTimeout(r, 200)); // manual play or hold
    if (!queue.length) break;
    const item = queue.shift();
    const p = item.kind === 'speech' ? playSpeech(item) : playAudio(item);
    const mine = current;
    emit();
    await p;
    if (current === mine) current = null;
    emit();
  }
  running = false;
  emit();
}

export function enqueue(item) { queue.push(item); emit(); run(); }

export function hold(on) {
  if (held === on) return;
  held = on;
  if (current && !current.done) { if (on) current.pause(); else current.resume(); }
  emit();
}

// The user pressed play on a note's own <audio>: it replaces whatever is playing.
export function claimElement(el, label) {
  if (current && current.el !== el) current.stop();
  let release;
  const done = new Promise((r) => { release = r; });
  current = { el, label: label || 'voice note', stop: () => el.pause(), pause: () => el.pause(), resume: () => {}, done };
  const off = () => { el.removeEventListener('pause', off); el.removeEventListener('ended', off); if (current && current.el === el) current = null; release(); emit(); };
  el.addEventListener('pause', off); el.addEventListener('ended', off);
  emit();
}

export function stopAll() {
  queue = [];
  if (current) current.stop();
  try { speechSynthesis.cancel(); } catch {}
  emit();
}
