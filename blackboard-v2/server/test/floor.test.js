'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Floor } = require('../src/floor');

function setup() {
  let now = 1000;
  let seq = 0;
  const timers = new Map();
  const clock = {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => timers.delete(id),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
  const f = new Floor(clock);
  const changes = [];
  const turns = [];
  f.on('change', (s, reason, userId) => changes.push({ ...s, reason, userId }));
  f.on('turn', (id, exp) => turns.push([id, exp]));
  return { f, clock, changes, turns };
}
const U = (id) => ({ id, name: id.toUpperCase(), role: 'member' });
const ids = (f) => f.snapshot().queue.map((q) => q.userId);

test('free floor is granted at once; others queue FIFO with positions', () => {
  const { f } = setup();
  f.request(U('a')); f.request(U('b')); f.request(U('c'));
  const s = f.snapshot();
  assert.equal(s.holder.userId, 'a');
  assert.equal(s.holder.deadline - s.holder.grantedAt, 120000);
  assert.deepEqual(s.queue, [{ userId: 'b', name: 'B', position: 1 }, { userId: 'c', name: 'C', position: 2 }]);
  assert.equal(s.pending, null);
});

test('simultaneous and repeated requests: single holder, no duplicates', () => {
  const { f } = setup();
  for (let i = 0; i < 3; i++) { f.request(U('a')); f.request(U('b')); f.request(U('a')); f.request(U('b')); }
  const s = f.snapshot();
  assert.equal(s.holder.userId, 'a');
  assert.deepEqual(ids(f), ['b']);
});

test('agents are rejected', () => {
  const { f } = setup();
  assert.throws(() => f.request({ id: 'x', name: 'X', role: 'agent' }), { code: 'agent_forbidden' });
  assert.equal(f.snapshot().holder, null);
});

test('leave by holder hands to next as pending with turn event; start confirms', () => {
  const { f, turns, clock } = setup();
  f.request(U('a')); f.request(U('b'));
  f.leave('a');
  let s = f.snapshot();
  assert.equal(s.holder, null);
  assert.equal(s.pending.userId, 'b');
  assert.equal(s.pending.expiresAt, clock.now() + 15000);
  assert.deepEqual(turns, [['b', s.pending.expiresAt]]);
  assert.equal(f.start('c'), false);
  assert.equal(f.start('b'), true);
  s = f.snapshot();
  assert.equal(s.holder.userId, 'b');
  assert.equal(s.pending, null);
  clock.advance(20000); // pending timer must be cancelled
  assert.equal(f.snapshot().holder.userId, 'b');
});

test('request while a turn is pending queues behind', () => {
  const { f } = setup();
  f.request(U('a')); f.request(U('b')); f.leave('a');
  f.request(U('c'));
  assert.equal(f.snapshot().holder, null);
  assert.deepEqual(ids(f), ['c']);
  f.request(U('b')); // pending user re-requesting is a no-op
  assert.deepEqual(ids(f), ['c']);
});

test('next speaker times out after 15 s and moves to back; next is offered', () => {
  const { f, clock, turns } = setup();
  f.request(U('a')); f.request(U('b')); f.request(U('c'));
  f.leave('a');
  clock.advance(14999);
  assert.equal(f.snapshot().pending.userId, 'b');
  clock.advance(1);
  const s = f.snapshot();
  assert.equal(s.pending.userId, 'c');
  assert.deepEqual(ids(f), ['b']);
  assert.deepEqual(turns.map((t) => t[0]), ['b', 'c']);
});

test('lone timed-out speaker is dropped, floor becomes idle', () => {
  const { f, clock } = setup();
  f.request(U('a')); f.request(U('b')); f.leave('a');
  clock.advance(15000);
  assert.deepEqual(f.snapshot(), { holder: null, queue: [], pending: null });
  f.request(U('b'));
  assert.equal(f.snapshot().holder.userId, 'b');
});

test('cap: 120 s from grant when never started; holder keeps floor for 20 s upload grace, then released (cap)', () => {
  const { f, clock, changes } = setup();
  f.request(U('a')); f.request(U('b'));
  clock.advance(120000);
  assert.equal(f.snapshot().holder.userId, 'a'); // still holds: upload grace
  clock.advance(19999);
  assert.equal(f.snapshot().holder.userId, 'a');
  clock.advance(1);
  assert.equal(f.snapshot().holder, null);
  assert.equal(f.snapshot().pending.userId, 'b');
  const last = changes.at(-1);
  assert.equal(last.reason, 'cap');
  assert.equal(last.userId, 'a');
});

test('cap counts from start(): immediate holder start resets it; pending start begins it', () => {
  const { f, clock } = setup();
  f.request(U('a')); f.request(U('b'));
  clock.advance(10000);
  assert.equal(f.start('a'), true);
  assert.equal(f.snapshot().holder.deadline, clock.now() + 120000);
  clock.advance(100000);
  assert.equal(f.start('a'), true); // repeat start does not extend
  assert.equal(f.snapshot().holder.deadline, clock.now() + 20000);
  clock.advance(39999); // 130 s cap + 20 s grace, counted from the first start
  assert.equal(f.snapshot().holder.userId, 'a');
  clock.advance(1);
  assert.equal(f.snapshot().pending.userId, 'b');
  clock.advance(10000);
  f.start('b');
  assert.equal(f.snapshot().holder.deadline, clock.now() + 120000);
  clock.advance(139999);
  assert.equal(f.snapshot().holder.userId, 'b');
});

test('a post during the upload grace releases normally with reason posted', () => {
  const { f, clock, changes } = setup();
  f.request(U('a')); f.start('a');
  clock.advance(125000);
  f.leave('a', 'posted');
  assert.equal(f.snapshot().holder, null);
  assert.deepEqual([changes.at(-1).reason, changes.at(-1).userId], ['posted', 'a']);
  clock.advance(60000); // grace timer cancelled
  assert.equal(f.snapshot().holder, null);
});

test('change reasons: cancelled, skipped_timeout, admin_skip, admin_clear, disconnect', () => {
  const { f, clock, changes } = setup();
  const last = () => [changes.at(-1).reason, changes.at(-1).userId];
  f.request(U('a')); f.request(U('b')); f.request(U('c'));
  f.leave('c');
  assert.deepEqual(last(), ['cancelled', 'c']);
  f.skip();
  assert.deepEqual(last(), ['admin_skip', 'a']);
  f.request(U('d'));
  clock.advance(15000);
  assert.deepEqual(last(), ['skipped_timeout', 'b']);
  f.removeFromQueue('b');
  assert.deepEqual(last(), ['admin_skip', 'b']);
  f.request(U('e'));
  f.clear();
  assert.deepEqual(last(), ['admin_clear', null]);
  f.request(U('d'));
  assert.equal(changes.at(-1).reason, undefined);
  f.disconnect('d');
  clock.advance(3000);
  assert.deepEqual(last(), ['disconnect', 'd']);
});

test('holder disconnect: released after 3 s grace, queue advances', () => {
  const { f, clock } = setup();
  f.request(U('a')); f.request(U('b'));
  f.disconnect('a');
  clock.advance(2999);
  assert.equal(f.snapshot().holder.userId, 'a');
  clock.advance(1);
  assert.equal(f.snapshot().holder, null);
  assert.equal(f.snapshot().pending.userId, 'b');
});

test('reconnect within grace keeps the floor (and a later disconnect still works)', () => {
  const { f, clock } = setup();
  f.request(U('a')); f.request(U('b'));
  f.disconnect('a');
  clock.advance(2000);
  f.connect('a');
  clock.advance(5000);
  assert.equal(f.snapshot().holder.userId, 'a');
  f.disconnect('a');
  f.disconnect('a'); // duplicate does not extend or double-fire
  clock.advance(3000);
  assert.equal(f.snapshot().holder, null);
});

test('queued and pending users who disconnect are removed after grace', () => {
  const { f, clock } = setup();
  f.request(U('a')); f.request(U('b')); f.request(U('c'));
  f.disconnect('c');
  clock.advance(3000);
  assert.deepEqual(ids(f), ['b']);
  f.leave('a'); // b pending
  f.disconnect('b');
  clock.advance(3000);
  assert.deepEqual(f.snapshot(), { holder: null, queue: [], pending: null });
});

test('disconnect of unknown user is harmless', () => {
  const { f, clock } = setup();
  f.disconnect('zzz');
  clock.advance(5000);
  assert.deepEqual(f.snapshot(), { holder: null, queue: [], pending: null });
});

test('admin skip drops holder; with only pending it drops pending', () => {
  const { f } = setup();
  f.request(U('a')); f.request(U('b')); f.request(U('c'));
  assert.equal(f.skip(), true);
  assert.equal(f.snapshot().pending.userId, 'b');
  assert.equal(f.skip(), true); // pending skipped
  assert.equal(f.snapshot().pending.userId, 'c');
  assert.equal(f.skip(), true);
  assert.equal(f.skip(), false);
});

test('removeFromQueue removes a queued user and renumbers', () => {
  const { f } = setup();
  f.request(U('a')); f.request(U('b')); f.request(U('c')); f.request(U('d'));
  f.removeFromQueue('c');
  assert.deepEqual(f.snapshot().queue.map((q) => [q.userId, q.position]), [['b', 1], ['d', 2]]);
  assert.equal(f.removeFromQueue('nobody'), false);
});

test('clear empties queue and pending but holder keeps the floor', () => {
  const { f, clock } = setup();
  f.request(U('a')); f.request(U('b')); f.request(U('c'));
  f.clear();
  assert.deepEqual(f.snapshot().queue, []);
  assert.equal(f.snapshot().holder.userId, 'a');
  f.request(U('d')); f.leave('a'); // d pending
  f.request(U('e'));
  f.clear();
  assert.deepEqual(f.snapshot(), { holder: null, queue: [], pending: null });
  clock.advance(60000);
  assert.deepEqual(f.snapshot(), { holder: null, queue: [], pending: null });
});

test('invariant: random ops never yield two holders or duplicates', () => {
  const { f, clock } = setup();
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const users = ['a', 'b', 'c', 'd', 'e'];
  for (let i = 0; i < 2000; i++) {
    const u = users[rnd(5)];
    [() => f.request(U(u)), () => f.leave(u), () => f.start(u), () => f.skip(), () => f.removeFromQueue(u),
      () => f.disconnect(u), () => f.connect(u), () => clock.advance(rnd(20000)), () => { if (rnd(10) === 0) f.clear(); }][rnd(9)]();
    const s = f.snapshot();
    const all = [s.holder && s.holder.userId, s.pending && s.pending.userId, ...s.queue.map((q) => q.userId)].filter(Boolean);
    assert.equal(new Set(all).size, all.length);
    assert.ok(!(s.holder && s.pending));
    if (!s.holder && !s.pending) assert.equal(s.queue.length, 0);
  }
});

test('change event fires on each transition with a snapshot', () => {
  const { f, changes } = setup();
  f.request(U('a'));
  f.request(U('b'));
  f.leave('a');
  assert.equal(changes.length, 3);
  assert.equal(changes[2].pending.userId, 'b');
});
