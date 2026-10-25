'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const { createVoice } = require('../src/voice');
const { transcribe } = require('../src/transcribe');

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(996, 7)]);
const M4A = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(100, 3)]);
const USERS = {
  a: { id: 'a', name: 'A', role: 'member' },
  b: { id: 'b', name: 'B', role: 'member' },
  adm: { id: 'adm', name: 'Admin', role: 'admin' },
  bot: { id: 'bot', name: 'Bot', role: 'agent' },
};

async function harness(cfg = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-'));
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE voice_notes (id TEXT PRIMARY KEY, path TEXT NOT NULL, duration_ms INTEGER, status TEXT NOT NULL, transcript TEXT, created_at INTEGER, user_id TEXT)`);
  const sent = [], bcast = [], chats = [];
  const v = createVoice({
    db, dataDir,
    config: { transcribe: async () => 'hello world', ...cfg },
    broadcast: (m) => bcast.push(m),
    sendTo: (id, m) => sent.push([id, m]),
    requireSession: (req, res, next) => {
      const u = USERS[req.get('x-user')];
      if (!u) return res.status(401).json({ error: 'unauthorized' });
      req.user = u; next();
    },
    postChat: async (u, m) => { chats.push([u.id, m]); return { id: 1, ...m }; },
  });
  const app = express();
  app.use('/voice', v.router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/voice`;
  const call = (user, p, opts = {}) => fetch(base + p, { method: 'POST', ...opts, headers: { 'x-user': user, ...(opts.headers || {}) } });
  const json = (user, p, body) => call(user, p, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const upload = (user, body = WEBM, headers = {}) =>
    call(user, '/notes', { headers: { 'content-type': 'audio/webm', 'x-duration-ms': '5000', ...headers }, body });
  const close = () => { server.closeAllConnections(); server.close(); db.close(); };
  return { v, db, sent, bcast, chats, call, json, upload, base, close, dataDir };
}
const waitFor = async (fn) => { for (let i = 0; i < 100; i++) { const r = fn(); if (r) return r; await new Promise((s) => setTimeout(s, 10)); } throw new Error('timeout'); };

test('floor routes: request, queue, broadcast, turn, leave', async () => {
  const h = await harness();
  try {
    let r = await h.json('a', '/floor/request');
    assert.equal((await r.json()).state.holder.userId, 'a');
    r = await h.json('b', '/floor/request');
    assert.deepEqual((await r.json()).state.queue.map((q) => q.userId), ['b']);
    assert.equal(h.bcast.at(-1).type, 'floor');
    await h.json('a', '/floor/leave');
    assert.deepEqual(h.sent[0][0], 'b');
    assert.equal(h.sent[0][1].type, 'floor_turn');
    assert.ok(h.sent[0][1].expiresAt > Date.now());
    assert.equal((await h.json('a', '/floor/start')).status, 409);
    r = await h.json('b', '/floor/start');
    assert.equal((await r.json()).state.holder.userId, 'b');
  } finally { h.close(); }
});

test('agents get 403, unauthenticated 401', async () => {
  const h = await harness();
  try {
    assert.equal((await h.json('bot', '/floor/request')).status, 403);
    assert.equal((await h.json('nobody', '/floor/request')).status, 401);
  } finally { h.close(); }
});

test('skip and clear are admin only; skip with userId removes from queue', async () => {
  const h = await harness();
  try {
    await h.json('a', '/floor/request'); await h.json('b', '/floor/request');
    assert.equal((await h.json('a', '/floor/skip')).status, 403);
    assert.equal((await h.json('b', '/floor/clear')).status, 403);
    let r = await h.json('adm', '/floor/skip', { userId: 'b' });
    assert.deepEqual((await r.json()).state.queue, []);
    r = await h.json('adm', '/floor/skip');
    assert.equal((await r.json()).state.holder, null);
    await h.json('a', '/floor/request'); await h.json('b', '/floor/request');
    r = await h.json('adm', '/floor/clear');
    assert.deepEqual((await r.json()).state.queue, []);
  } finally { h.close(); }
});

test('upload by non-holder is 403 not_holder', async () => {
  const h = await harness();
  try {
    await h.json('a', '/floor/request'); await h.json('b', '/floor/request');
    const r = await h.upload('b');
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error, 'not_holder');
    assert.equal((await h.upload('adm')).status, 403);
  } finally { h.close(); }
});

test('holder upload: stored under uuid name, row, chat, floor released, transcript broadcast', async () => {
  const h = await harness();
  try {
    await h.json('a', '/floor/request'); await h.json('b', '/floor/request');
    const r = await h.upload('a', WEBM, { 'content-type': 'audio/webm;codecs=opus' });
    assert.equal(r.status, 201);
    const { id } = await r.json();
    assert.match(id, /^[0-9a-f-]{36}$/);
    const row = h.db.prepare('SELECT * FROM voice_notes WHERE id=?').get(id);
    assert.equal(row.path, path.join(h.dataDir, 'audio', `${id}.webm`));
    assert.equal(row.duration_ms, 5000);
    assert.equal(row.user_id, 'a');
    assert.ok(fs.readFileSync(row.path).equals(WEBM));
    assert.deepEqual(h.chats[0], ['a', { text: '', voice_note_id: id }]);
    const s = h.v.floor.snapshot();
    assert.equal(s.holder, null);
    assert.equal(s.pending.userId, 'b');
    const m = await waitFor(() => h.bcast.find((x) => x.type === 'voice'));
    assert.deepEqual(m, { type: 'voice', id, status: 'done', transcript: 'hello world' });
    const meta = await (await h.call('b', `/notes/${id}`, { method: 'GET' })).json();
    assert.deepEqual(meta, { id, duration_ms: 5000, status: 'done', transcript: 'hello world' });
    // holder gave up the floor, so a second upload is rejected
    assert.equal((await h.upload('a')).status, 403);
  } finally { h.close(); }
});

test('upload validation: type, magic bytes, size, duration', async () => {
  const h = await harness();
  try {
    await h.json('a', '/floor/request');
    assert.equal((await h.upload('a', WEBM, { 'content-type': 'audio/mpeg' })).status, 415);
    assert.equal((await h.upload('a', WEBM, { 'content-type': 'audio/mp4' })).status, 415); // webm bytes, mp4 claim
    assert.equal((await h.upload('a', M4A, { 'content-type': 'audio/webm' })).status, 415);
    assert.equal((await h.upload('a', Buffer.alloc(100, 1))).status, 415);
    assert.equal((await h.upload('a', WEBM, { 'x-duration-ms': '120001' })).status, 413);
    assert.equal((await h.upload('a', WEBM, { 'x-duration-ms': 'abc' })).status, 400);
    const big = Buffer.concat([WEBM, Buffer.alloc(5 * 1024 * 1024)]);
    assert.equal((await h.upload('a', big)).status, 413);
    assert.equal(h.db.prepare('SELECT count(*) c FROM voice_notes').get().c, 0);
    assert.equal(h.v.floor.snapshot().holder.userId, 'a'); // failures keep the floor
    assert.equal((await h.upload('a', WEBM, { 'x-duration-ms': '120000' })).status, 201);
  } finally { h.close(); }
});

test('stub provider gives disabled; failures give failed', async () => {
  for (const [t, want] of [[async () => { const e = new Error('x'); e.code = 'DISABLED'; throw e; }, 'disabled'], [async () => { throw new Error('boom'); }, 'failed']]) {
    const h = await harness({ transcribe: t });
    try {
      await h.json('a', '/floor/request');
      const { id } = await (await h.upload('a')).json();
      const m = await waitFor(() => h.bcast.find((x) => x.type === 'voice'));
      assert.equal(m.status, want);
      assert.equal(m.transcript, null);
      assert.equal(h.db.prepare('SELECT status FROM voice_notes WHERE id=?').get(id).status, want);
    } finally { h.close(); }
  }
});

test('audio: session only, full, Range, bad range, 404', async () => {
  const h = await harness();
  try {
    await h.json('a', '/floor/request');
    const { id } = await (await h.upload('a')).json();
    const get = (u, hd = {}) => fetch(`${h.base}/notes/${id}/audio`, { headers: { ...(u ? { 'x-user': u } : {}), ...hd } });
    assert.equal((await get(null)).status, 401);
    let r = await get('b');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'audio/webm');
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(WEBM));
    r = await get('b', { range: 'bytes=10-19' });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), `bytes 10-19/${WEBM.length}`);
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(WEBM.subarray(10, 20)));
    r = await get('b', { range: 'bytes=990-' });
    assert.equal(r.status, 206);
    assert.equal((await r.arrayBuffer()).byteLength, 10);
    r = await get('b', { range: 'bytes=-4' });
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(WEBM.subarray(WEBM.length - 4)));
    assert.equal((await get('b', { range: 'bytes=5000-' })).status, 416);
    const nf = await fetch(`${h.base}/notes/nope/audio`, { headers: { 'x-user': 'b' } });
    assert.equal(nf.status, 404);
  } finally { h.close(); }
});

test('ws hooks: last socket closing starts disconnect grace', async () => {
  const h = await harness({ floor: new (require('../src/floor').Floor)({ graceMs: 30 }) });
  try {
    await h.json('a', '/floor/request');
    h.v.onWsConnect({}, USERS.a); h.v.onWsConnect({}, USERS.a);
    h.v.onWsClose(USERS.a);
    await new Promise((s) => setTimeout(s, 60));
    assert.equal(h.v.floor.snapshot().holder.userId, 'a');
    h.v.onWsClose(USERS.a);
    await waitFor(() => h.v.floor.snapshot().holder === null);
  } finally { h.close(); }
});

test('transcribe providers: stub disabled, missing keys, mocked fetch', async () => {
  const env = { ...process.env };
  const realFetch = global.fetch;
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tr-')), 'a.webm');
  fs.writeFileSync(f, WEBM);
  let calls = [];
  global.fetch = async (url, init) => { calls.push([url, init]); throw new Error('network!'); };
  try {
    delete process.env.TRANSCRIBE_PROVIDER; delete process.env.OPENAI_API_KEY; delete process.env.DEEPGRAM_API_KEY;
    await assert.rejects(transcribe(f), { code: 'DISABLED' });
    process.env.TRANSCRIBE_PROVIDER = 'openai';
    await assert.rejects(transcribe(f), /OPENAI_API_KEY/);
    process.env.TRANSCRIBE_PROVIDER = 'deepgram';
    await assert.rejects(transcribe(f), /DEEPGRAM_API_KEY/);
    process.env.TRANSCRIBE_PROVIDER = 'nope';
    await assert.rejects(transcribe(f), /unknown/);
    assert.equal(calls.length, 0);

    process.env.TRANSCRIBE_PROVIDER = 'openai'; process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = async (url, init) => { calls.push([url, init]); return { ok: true, json: async () => ({ text: 'hi openai' }) }; };
    assert.equal(await transcribe(f), 'hi openai');
    assert.equal(calls[0][0], 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(calls[0][1].headers.Authorization, 'Bearer test-key');
    assert.ok(calls[0][1].body instanceof FormData);
    assert.equal(calls[0][1].body.get('model'), 'whisper-1');

    process.env.TRANSCRIBE_PROVIDER = 'deepgram'; process.env.DEEPGRAM_API_KEY = 'dg-key';
    global.fetch = async (url, init) => { calls.push([url, init]); return { ok: true, json: async () => ({ results: { channels: [{ alternatives: [{ transcript: 'hi dg' }] }] } }) }; };
    assert.equal(await transcribe(f), 'hi dg');
    assert.match(calls[1][0], /^https:\/\/api\.deepgram\.com\/v1\/listen/);
    assert.equal(calls[1][1].headers.Authorization, 'Token dg-key');
    assert.equal(calls[1][1].headers['Content-Type'], 'audio/webm');

    global.fetch = async () => ({ ok: false, status: 500 });
    await assert.rejects(transcribe(f), /HTTP 500/);
  } finally {
    global.fetch = realFetch;
    for (const k of ['TRANSCRIBE_PROVIDER', 'OPENAI_API_KEY', 'DEEPGRAM_API_KEY']) { if (k in env) process.env[k] = env[k]; else delete process.env[k]; }
  }
});

test('mp4/aac upload is stored as .m4a and served as audio/mp4', async () => {
  const h = await harness();
  try {
    await h.json('a', '/floor/request');
    const r = await h.upload('a', M4A, { 'content-type': 'audio/mp4' });
    assert.equal(r.status, 201);
    const { id } = await r.json();
    assert.equal(h.db.prepare('SELECT path FROM voice_notes WHERE id=?').get(id).path, path.join(h.dataDir, 'audio', `${id}.m4a`));
    const a = await fetch(`${h.base}/notes/${id}/audio`, { headers: { 'x-user': 'b' } });
    assert.equal(a.headers.get('content-type'), 'audio/mp4');
    assert.ok(Buffer.from(await a.arrayBuffer()).equals(M4A));
  } finally { h.close(); }
});

test('floor broadcasts carry reason and userId; upload is accepted during cap upload grace', async () => {
  const Floor = require('../src/floor').Floor;
  const h = await harness({ floor: new Floor({ capMs: 40, uploadGraceMs: 300 }) });
  try {
    await h.json('a', '/floor/request'); await h.json('a', '/floor/start');
    await new Promise((s) => setTimeout(s, 100)); // past the cap, inside the grace
    assert.equal(h.v.floor.snapshot().holder.userId, 'a');
    assert.equal((await h.upload('a')).status, 201);
    const m = h.bcast.filter((x) => x.type === 'floor').at(-1);
    assert.equal(m.reason, 'posted');
    assert.equal(m.userId, 'a');
    await h.json('b', '/floor/request');
    await h.json('adm', '/floor/skip');
    const m2 = h.bcast.filter((x) => x.type === 'floor').at(-1);
    assert.deepEqual([m2.reason, m2.userId], ['admin_skip', 'b']);
  } finally { h.close(); }
});
