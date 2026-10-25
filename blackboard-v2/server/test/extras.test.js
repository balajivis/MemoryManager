'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { startServer, makeUser, makeAgent } = require('./helpers');

test('tiles, item detail with history and linked entries', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const m = await makeUser(s, { email: 'm@x.test', name: 'm' });
  const admin = await makeUser(s, { email: 'root@x.test', name: 'root', role: 'admin' });
  const dev = await makeAgent(s, admin, 'dev');
  const a = (await dev.post('/items', { title: 'Login page', stage: 'built', owner: 'dev', needed: 'review' })).body;
  const b = (await m.post('/items', { title: 'Voice notes', stage: 'live' })).body;
  await m.patch(`/items/${a.id}`, { stage: 'tested', status: 'green' });
  await dev.post('/bb/log', { kind: 'done', text: `tested the login page, see #${a.id}` });
  await dev.post('/bb/log', { kind: 'obs', text: 'unrelated note' });
  await dev.post('/bb/log', { kind: 'obs', text: `item #${a.id}0 is not ours` });

  const board = (await m.get('/board')).body;
  assert.deepEqual(board.tiles.cards.map((c) => c.key), ['blocked', 'in_progress', 'delivered', 'live', 'all']);
  assert.equal(board.tiles.blocked, 1);
  assert.equal(board.tiles.in_progress, 1);
  assert.equal(board.tiles.live, 1);
  assert.equal(board.tiles.all, 2);

  const blocked = (await m.get('/board/tiles/blocked')).body;
  assert.equal(blocked.tile, 'blocked');
  assert.deepEqual(blocked.items.map((i) => i.id), [a.id]);
  assert.equal(blocked.entries.length, 1);
  assert.match(blocked.entries[0].text, /login page/);
  assert.equal((await dev.get('/board/tiles/live')).body.items[0].id, b.id);
  assert.equal((await m.get('/board/tiles/nope')).status, 404);

  const d = (await m.get(`/items/${a.id}`)).body;
  assert.deepEqual(d.history.map((h) => [h.stage, h.status, h.by]), [['built', '', 'dev'], ['tested', 'green', 'm']]);
  assert.ok(d.history[0].at);
  assert.equal(d.entries.length, 1);
  assert.equal((await m.get('/items/999')).status, 404);
});

test('daily summaries: agent upsert by day, list, get, WS push', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const m = await makeUser(s, { email: 'm@x.test', name: 'm' });
  const admin = await makeUser(s, { email: 'root@x.test', name: 'root', role: 'admin' });
  const pm = await makeAgent(s, admin, 'pm');

  const ws = new WebSocket(s.base.replace('http', 'ws') + '/board/api/ws', { headers: { cookie: m.cookie } });
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d)));
  await new Promise((r) => ws.on('open', r));

  const body = { day: '2026-10-25', text: 'good day', done: [{ title: 'login', owner: 'dev' }], blocked: [{ title: 'tls', needed: 'domain' }] };
  assert.equal((await m.post('/summaries', body)).status, 403); // agents only
  assert.equal((await pm.post('/summaries', { ...body, day: '25-10-2026' })).status, 400);
  assert.equal((await pm.post('/summaries', { ...body, text: 'x'.repeat(8193) })).status, 413);
  const r = await pm.post('/summaries', body);
  assert.equal(r.status, 201);
  assert.equal(r.body.summary.author, 'pm');
  await pm.post('/summaries', { ...body, text: 'edited' }); // upsert
  await pm.post('/summaries', { ...body, day: '2026-10-24', text: 'older' });

  const list = (await m.get('/summaries?limit=14')).body.summaries;
  assert.deepEqual(list.map((x) => [x.day, x.text]), [['2026-10-25', 'edited'], ['2026-10-24', 'older']]);
  assert.deepEqual(list[0].done, [{ title: 'login', owner: 'dev' }]);
  assert.equal((await pm.get('/summaries')).status, 200);
  assert.equal((await m.get('/summaries/2026-10-25')).body.summary.text, 'edited');
  assert.equal((await m.get('/summaries/2020-01-01')).status, 404);
  await new Promise((r2) => setTimeout(r2, 100));
  assert.equal(msgs.filter((x) => x.type === 'summary').length, 3);
  ws.terminate();
});
