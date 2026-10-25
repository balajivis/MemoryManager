'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startServer, Client, makeUser, makeAgent } = require('./helpers');
const { createInvite } = require('../src/auth');
const { createVoice } = require('../src/voice');

const tokenOf = (url) => new URL(url).hash.slice(1);

test('R1: unknown and real emails lock identically (429 + Retry-After), 401 body shape is the same', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const u = await makeUser(s, { email: 'real@x.test', name: 'real' });
  const c = new Client(s.base);
  const out = {};
  for (const [k, em] of [['real', 'Real@x.test'], ['ghost', 'ghost@x.test']]) {
    out[k] = [];
    for (let i = 0; i < 6; i++) { const r = await c.post('/auth/login', { email: em, password: 'wrong password ' + i }); out[k].push(r); }
  }
  for (let i = 0; i < 6; i++) {
    assert.equal(out.real[i].status, out.ghost[i].status);
    assert.deepEqual(out.real[i].body.error, out.ghost[i].body.error);
    assert.deepEqual(Object.keys(out.real[i].body), Object.keys(out.ghost[i].body));
  }
  assert.deepEqual(out.real.map((r) => r.status), [401, 401, 401, 401, 401, 429]);
  assert.deepEqual(out.real[5].body.error, 'too_many_attempts');
  assert.ok(Number(out.real[5].headers.get('retry-after')) > 0);
  assert.ok(Number(out.ghost[5].headers.get('retry-after')) > 0);
  // correct password is refused while locked
  assert.equal((await c.post('/auth/login', { email: 'real@x.test', password: u.password })).status, 429);
});

test('R2: lockout is per (account, IP); CLI unlock clears it', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const u = await makeUser(s, { email: 'adm@x.test', name: 'adm', role: 'admin' });
  const c = new Client(s.base);
  for (let i = 0; i < 5; i++) await c.post('/auth/login', { email: 'adm@x.test', password: 'bad bad bad bad ' + i });
  assert.equal((await c.post('/auth/login', { email: 'adm@x.test', password: u.password })).status, 429);
  // the same account from another IP is unaffected: simulate by moving the lock record to a stranger's IP
  s.db.prepare("UPDATE login_fails SET ip = '203.0.113.9'").run();
  assert.equal((await c.post('/auth/login', { email: 'adm@x.test', password: u.password })).status, 200);
  // lock again, then unlock through the CLI
  const c2 = new Client(s.base);
  for (let i = 0; i < 5; i++) await c2.post('/auth/login', { email: 'adm@x.test', password: 'bad bad bad bad ' + i });
  assert.equal((await c2.post('/auth/login', { email: 'adm@x.test', password: u.password })).status, 429);
  s.db.pragma('wal_checkpoint(FULL)');
  const out = execFileSync('node', [path.join(__dirname, '../src/cli.js'), 'unlock', 'ADM@x.test'], { env: { ...process.env, DATA_DIR: s.dir, DB_PATH: path.join(s.dir, 'board.db') } }).toString();
  assert.match(out, /unlocked adm@x\.test/);
  assert.equal((await c2.post('/auth/login', { email: 'adm@x.test', password: u.password })).status, 200);
});

test('R3: invite token travels in the body; single use; 48h expiry; old routes gone', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const { url } = createInvite(s.db, s.config, { email: 'n@x.test', name: 'nn', role: 'member' });
  assert.equal(url, `http://x.test/board/invite/#${tokenOf(url)}`);
  const inv = s.db.prepare('SELECT expires_at, created_at FROM invites').get();
  const hrs = (Date.parse(inv.expires_at) - Date.parse(inv.created_at)) / 3600000;
  assert.ok(hrs > 47.9 && hrs < 48.1, String(hrs));
  const token = tokenOf(url);
  const c = new Client(s.base);
  assert.equal((await c.get(`/auth/invite/${token}`)).status, 401);
  assert.equal((await c.post(`/auth/invite/${token}`, { password: 'long enough password' })).status, 401);
  assert.deepEqual((await c.post('/auth/invite/lookup', { token })).body, { email: 'n@x.test', name: 'nn' });
  assert.equal((await c.post('/auth/invite/accept', { token, password: 'long enough password' })).status, 201);
  assert.equal((await c.post('/auth/invite/accept', { token, password: 'long enough password' })).status, 404);
  assert.equal((await c.post('/auth/invite/lookup', { token })).status, 404);
  // expired
  const e = createInvite(s.db, s.config, { email: 'e@x.test', name: 'ee', role: 'member' });
  s.db.prepare('UPDATE invites SET expires_at = ? WHERE email = ?').run(new Date(Date.now() - 1000).toISOString(), 'e@x.test');
  assert.equal((await c.post('/auth/invite/lookup', { token: tokenOf(e.url) })).status, 404);
  assert.equal((await c.post('/auth/invite/lookup', {})).status, 404);
});

test('R4: human chat reaches agents as human:<name>; agent cannot take a user name', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const admin = await makeUser(s, { email: 'a@x.test', name: 'admin', role: 'admin' });
  await makeUser(s, { email: 'd@x.test', name: 'dev' });
  await makeUser(s, { email: 'l@x.test', name: 'Ann Lee' });
  const r = await admin.post('/admin/agents', { name: 'dev', role: 'x' });
  assert.equal(r.status, 409);
  assert.equal((await admin.post('/admin/agents', { name: 'ann-lee', role: 'x' })).status, 409);
  const bot = await makeAgent(s, admin, 'bot');
  await admin.post('/chat', { text: 'hello agents' });
  const rd = (await bot.get('/bb/read')).body.entries;
  assert.equal(rd.length, 1);
  assert.equal(rd[0].author, 'human:admin');
  assert.equal(rd[0].source, 'chat');
});

test('R9: idle timeout 12h, absolute 14d, rotation at login, other sessions die on password change', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const u = await makeUser(s, { email: 'u@x.test', name: 'uu' });
  const row = () => s.db.prepare('SELECT * FROM sessions').all();
  const age = (ms) => new Date(Date.now() - ms).toISOString();
  const H = 3600000;
  // absolute lifetime is 14 days
  const sess = row()[0];
  assert.ok(Math.abs(Date.parse(sess.expires_at) - Date.parse(sess.created_at) - 14 * 24 * H) < 5000);
  assert.match(u.cookie, /^bb_session=/);
  // idle
  s.db.prepare('UPDATE sessions SET last_seen_at = ?').run(age(11 * H));
  assert.equal((await u.get('/auth/me')).status, 200);
  s.db.prepare('UPDATE sessions SET last_seen_at = ?').run(age(13 * H));
  assert.equal((await u.get('/auth/me')).status, 401);
  // absolute
  const u2 = new Client(s.base);
  await u2.post('/auth/login', { email: 'u@x.test', password: u.password });
  s.db.prepare('UPDATE sessions SET expires_at = ?').run(age(1000));
  assert.equal((await u2.get('/auth/me')).status, 401);
  // rotation: login while presenting an old cookie replaces that session id
  const u3 = new Client(s.base);
  await u3.post('/auth/login', { email: 'u@x.test', password: u.password });
  const before = u3.cookie;
  await u3.post('/auth/login', { email: 'u@x.test', password: u.password });
  assert.notEqual(u3.cookie, before);
  assert.equal((await new Client(s.base).req('GET', '/auth/me', undefined, { cookie: before })).status, 401);
  assert.equal((await u3.get('/auth/me')).status, 200);
  // password change deletes other sessions, keeps this one
  const other = new Client(s.base);
  await other.post('/auth/login', { email: 'u@x.test', password: u.password });
  assert.equal((await u3.post('/auth/password', { current: 'wrong wrong wrong', password: 'brand new password!' })).status, 401);
  assert.equal((await u3.post('/auth/password', { current: u.password, password: 'brand new password!' })).status, 200);
  assert.equal((await other.get('/auth/me')).status, 401);
  assert.equal((await u3.get('/auth/me')).status, 200);
  assert.equal((await new Client(s.base).post('/auth/login', { email: 'u@x.test', password: 'brand new password!' })).status, 200);
});

test('R10: password max 256 bytes, JSON body limit 64 KB', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const { url } = createInvite(s.db, s.config, { email: 'p@x.test', name: 'pp', role: 'member' });
  const c = new Client(s.base);
  const r = await c.post('/auth/invite/accept', { token: tokenOf(url), password: 'x'.repeat(257) });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'password_too_long');
  assert.equal((await c.post('/auth/invite/accept', { token: tokenOf(url), password: 'é'.repeat(129) })).status, 400); // 258 bytes
  assert.equal((await c.post('/auth/login', { email: 'p@x.test', password: 'x'.repeat(10000) })).status, 400);
  assert.equal((await c.post('/auth/invite/accept', { token: tokenOf(url), password: 'x'.repeat(256) })).status, 201);
  assert.equal((await c.post('/auth/login', { email: 'p@x.test', password: 'y'.repeat(5000) })).status, 400);
  const big = await c.post('/auth/login', { email: 'a@x.test', password: 'x', pad: 'z'.repeat(70 * 1024) });
  assert.equal(big.status, 413);
});

test('F7: a pending (granted, not yet started) speaker may upload', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const a = await makeUser(s, { email: 'a@x.test', name: 'aa' });
  const b = await makeUser(s, { email: 'b@x.test', name: 'bb' });
  await a.post('/voice/floor/request'); await b.post('/voice/floor/request');
  await a.post('/voice/floor/leave');
  const st = (await b.get('/board')).status; assert.equal(st, 200);
  assert.equal(s.voice.floor.snapshot().pending.userId, b.user.id);
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(996, 7)]);
  const r = await fetch(`${s.base}/board/api/voice/notes`, { method: 'POST', body: webm,
    headers: { cookie: b.cookie, 'x-csrf-token': b.csrf, 'content-type': 'audio/webm', 'x-duration-ms': '1000' } });
  assert.equal(r.status, 201);
  const f = s.voice.floor.snapshot();
  assert.equal(f.holder, null);
  assert.equal(f.pending, null);
});
