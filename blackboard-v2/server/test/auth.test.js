'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { startServer, Client, makeUser, makeAgent } = require('./helpers');
const { createInvite } = require('../src/auth');

test('logged out: every API call is 401 except the public ones', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const c = new Client(s.base);
  const routes = [
    ['GET', '/auth/me'], ['POST', '/auth/logout'], ['POST', '/auth/logout-all'],
    ['POST', '/admin/invites'], ['GET', '/admin/users'], ['DELETE', '/admin/users/1'],
    ['POST', '/admin/agents'], ['GET', '/admin/agents'], ['POST', '/admin/agents/x/rotate'], ['DELETE', '/admin/agents/x'],
    ['POST', '/bb/register'], ['POST', '/bb/log'], ['GET', '/bb/read'], ['GET', '/bb/who'], ['GET', '/bb/feed'],
    ['GET', '/bb/export'], ['POST', '/bb/import'], ['GET', '/board'], ['PUT', '/board/directive'], ['PUT', '/board/strategy'],
    ['GET', '/items'], ['POST', '/items'], ['PATCH', '/items/1'], ['GET', '/chat'], ['POST', '/chat'],
    ['POST', '/voice/floor/request'], ['GET', '/voice/notes/1/audio'], ['GET', '/no/such/route'],
  ];
  for (const [m, p] of routes) {
    const r = await c.req(m, p, m === 'GET' ? undefined : {});
    assert.equal(r.status, 401, `${m} ${p}`);
  }
  assert.equal((await c.get('/healthz')).status, 200);
  assert.equal((await c.post('/auth/invite/lookup', { token: 'nope' })).status, 404);
  assert.equal((await c.post('/auth/invite/accept', { token: 'nope', password: 'long enough password' })).status, 404);
  const bad = new Client(s.base); bad.token = 'bbt_nope';
  assert.equal((await bad.get('/bb/read')).status, 401);
});

test('security headers and noindex', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const r = await new Client(s.base).get('/healthz');
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.ok(r.headers.get('content-security-policy'));
});

test('invite flow: set password, log in, appear in roster; invite is single use', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const admin = await makeUser(s, { email: 'root@x.test', name: 'root', role: 'admin' });
  const inv = await admin.post('/admin/invites', { email: 'Ann@x.test', name: 'ann', role: 'member' });
  assert.equal(inv.status, 201);
  assert.match(inv.body.url, /^http:\/\/x\.test\/board\/invite\/#[0-9a-f]{64}$/);
  const token = new URL(inv.body.url).hash.slice(1);
  // only the hash is stored
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM invites WHERE token_hash = ?').get(token).n, 0);

  const ann = new Client(s.base);
  assert.deepEqual((await ann.post('/auth/invite/lookup', { token })).body, { email: 'ann@x.test', name: 'ann' });
  assert.equal((await ann.post('/auth/invite/accept', { token, password: 'short' })).status, 400);
  const ok = await ann.post('/auth/invite/accept', { token, password: 'a long enough password' });
  assert.equal(ok.status, 201);
  const cookie = (await fetch(`${s.base}/board/api/auth/me`, { headers: { cookie: ann.cookie } }));
  assert.equal(cookie.status, 200);
  assert.equal((await new Client(s.base).post('/auth/invite/accept', { token, password: 'another long password' })).status, 404);

  const again = new Client(s.base);
  assert.equal((await again.post('/auth/login', { email: 'ann@x.test', password: 'a long enough password' })).status, 200);
  const me = await again.get('/auth/me');
  assert.equal(me.body.user.name, 'ann');
  assert.ok(me.body.csrf);
  const roster = (await again.get('/board')).body.roster;
  assert.ok(roster.find((p) => p.name === 'ann' && p.kind === 'human'));
  // members can't use admin routes
  assert.equal((await again.post('/admin/invites', { email: 'z@x.test', name: 'z' })).status, 403);
  assert.equal((await again.get('/admin/users')).status, 403);
});

test('cookie attributes', async (t) => {
  const s = await startServer({ insecureCookies: false }); t.after(s.stop);
  const { url } = createInvite(s.db, s.config, { email: 'a@x.test', name: 'a', role: 'admin' });
  const token = new URL(url).hash.slice(1);
  const r = await fetch(`${s.base}/board/api/auth/invite/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password: 'long enough password' }) });
  const c = r.headers.getSetCookie()[0];
  for (const a of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/board']) assert.ok(c.includes(a), a);
});

test('lockout: 5 wrong passwords lock the account for 15 minutes', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const u = await makeUser(s, { email: 'lock@x.test', name: 'lock' });
  const c = new Client(s.base);
  const unknown = await c.post('/auth/login', { email: 'nobody@x.test', password: 'whatever whatever' });
  for (let i = 0; i < 5; i++) {
    const r = await c.post('/auth/login', { email: 'lock@x.test', password: 'wrong password ' + i });
    assert.equal(r.status, 401);
    assert.deepEqual(r.body, unknown.body); // same error as an unknown email
  }
  const locked = await c.post('/auth/login', { email: 'lock@x.test', password: u.password });
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error, 'too_many_attempts');
  // lock expires
  s.db.prepare("UPDATE login_fails SET first_at = first_at - 16 * 60 * 1000").run();
  assert.equal((await c.post('/auth/login', { email: 'lock@x.test', password: u.password })).status, 200);
});

test('per-IP login rate limit', async (t) => {
  const s = await startServer({ loginIpMax: 3 }); t.after(s.stop);
  const c = new Client(s.base);
  for (let i = 0; i < 3; i++) assert.equal((await c.post('/auth/login', { email: 'a@x.test', password: 'x' })).status, 401);
  assert.equal((await c.post('/auth/login', { email: 'a@x.test', password: 'x' })).status, 429);
});

test('CSRF and Origin checks on session writes; agents exempt', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const admin = await makeUser(s, { email: 'root@x.test', name: 'root', role: 'admin' });
  assert.equal((await admin.post('/chat', { text: 'hi' }, { 'x-csrf-token': null })).status, 403);
  assert.equal((await admin.post('/chat', { text: 'hi' }, { 'x-csrf-token': 'wrong' })).status, 403);
  assert.equal((await admin.post('/chat', { text: 'hi' })).status, 201);
  assert.equal((await admin.get('/chat', { 'x-csrf-token': null })).status, 200); // reads need no token
  assert.equal((await admin.post('/chat', { text: 'x' }, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await admin.post('/chat', { text: 'x' }, { origin: s.base })).status, 201);
  const agent = await makeAgent(s, admin, 'dev');
  assert.equal((await agent.post('/chat', { text: 'from agent' })).status, 201);
});

test('logout and logout-all end sessions', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const u = await makeUser(s, { email: 'u@x.test', name: 'u' });
  const second = new Client(s.base);
  await second.post('/auth/login', { email: 'u@x.test', password: u.password });
  assert.equal((await u.post('/auth/logout')).status, 200);
  assert.equal((await u.get('/auth/me')).status, 401);
  assert.equal((await second.get('/auth/me')).status, 200);
  const third = new Client(s.base);
  await third.post('/auth/login', { email: 'u@x.test', password: u.password });
  assert.equal((await third.post('/auth/logout-all')).status, 200);
  assert.equal((await second.get('/auth/me')).status, 401);
});

test('admin: delete user kills sessions; cannot delete self', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const admin = await makeUser(s, { email: 'root@x.test', name: 'root', role: 'admin' });
  const m = await makeUser(s, { email: 'm@x.test', name: 'm' });
  const users = (await admin.get('/admin/users')).body.users;
  assert.equal(users.length, 2);
  assert.equal((await admin.del(`/admin/users/${admin.user.id}`)).status, 400);
  assert.equal((await admin.del(`/admin/users/${m.user.id}`)).status, 200);
  assert.equal((await m.get('/auth/me')).status, 401);
});

test('agent tokens: create, auth, rotate, delete; stored hashed', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const admin = await makeUser(s, { email: 'root@x.test', name: 'root', role: 'admin' });
  const created = await admin.post('/admin/agents', { name: 'dev', role: 'builds' });
  assert.equal(created.status, 201);
  assert.equal((await admin.post('/admin/agents', { name: 'dev' })).status, 409);
  assert.equal((await admin.post('/admin/agents', { name: 'Bad Name' })).status, 400);
  const row = s.db.prepare("SELECT token_hash FROM agents WHERE name='dev'").get();
  assert.notEqual(row.token_hash, created.body.token);
  const agent = new Client(s.base); agent.token = created.body.token;
  assert.equal((await agent.get('/bb/who')).status, 200);
  assert.equal((await agent.get('/admin/users')).status, 403);
  assert.equal((await agent.post('/bb/register', { name: 'someone-else', role: 'x' })).status, 403);
  const rot = await admin.post('/admin/agents/dev/rotate');
  assert.equal((await agent.get('/bb/who')).status, 401);
  agent.token = rot.body.token;
  assert.equal((await agent.get('/bb/who')).status, 200);
  assert.equal((await admin.del('/admin/agents/dev')).status, 200);
  assert.equal((await agent.get('/bb/who')).status, 401);
  assert.equal((await admin.get('/admin/agents')).body.agents.length, 0);
});

test('chat is live over WebSocket in under 2s; WS needs session and good origin', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const a = await makeUser(s, { email: 'a@x.test', name: 'alice', role: 'admin' });
  const b = await makeUser(s, { email: 'b@x.test', name: 'bob' });
  const url = s.base.replace('http', 'ws') + '/board/api/ws';

  const noAuth = new WebSocket(url);
  await new Promise((res) => noAuth.on('error', res).on('unexpected-response', (q, r) => { assert.equal(r.statusCode, 401); res(); }));
  const evil = new WebSocket(url, { headers: { cookie: b.cookie, origin: 'https://evil.test' } });
  await new Promise((res) => evil.on('error', res).on('unexpected-response', (q, r) => { assert.equal(r.statusCode, 403); res(); }));

  const ws = new WebSocket(url, { headers: { cookie: b.cookie, origin: s.base } });
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d)));
  await new Promise((res) => ws.on('open', res));
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(msgs[0].type, 'hello');
  assert.equal(msgs[0].user.name, 'bob');
  assert.ok(msgs.some((m) => m.type === 'presence' && m.online.includes('bob')));

  const t0 = Date.now();
  await a.post('/chat', { text: 'hello bob' });
  while (!msgs.some((m) => m.type === 'chat') && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 10));
  const chat = msgs.find((m) => m.type === 'chat');
  assert.ok(chat, 'chat message arrived');
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(chat.message.text, 'hello bob');
  assert.equal(chat.message.author, 'alice');

  ws.send(JSON.stringify({ type: 'ping' }));
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(msgs.some((m) => m.type === 'pong'));

  // logout closes the socket
  const closed = new Promise((res) => ws.on('close', res));
  await b.post('/auth/logout');
  await closed;
  ws.terminate();
});

test('board: directive, strategy, items, tiles', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const m = await makeUser(s, { email: 'm@x.test', name: 'm' });
  const admin = await makeUser(s, { email: 'root@x.test', name: 'root', role: 'admin' });
  const agent = await makeAgent(s, admin, 'dev');
  assert.equal((await m.put('/board/directive', { text: 'ship it' })).status, 200);
  assert.equal((await m.put('/board/strategy', { text: 'plan' })).status, 200);
  assert.equal((await agent.put('/board/directive', { text: 'x' })).status, 403);
  const it = await agent.post('/items', { title: 'login', stage: 'built', needed: 'review' });
  assert.equal(it.status, 201);
  assert.equal((await m.post('/items', { title: 'x', stage: 'bogus' })).status, 400);
  const up = await m.patch(`/items/${it.body.id}`, { stage: 'live' });
  assert.equal(up.body.stage, 'live');
  assert.equal((await m.patch('/items/999', { stage: 'live' })).status, 404);
  const b = (await m.get('/board')).body;
  assert.equal(b.directive, 'ship it');
  assert.equal(b.strategy, 'plan');
  assert.equal(b.tiles.delivered, 1);
  assert.equal(b.items.length, 1);
  assert.equal((await m.get('/items')).body.items.length, 1);
});

test('chat history paging', async (t) => {
  const s = await startServer(); t.after(s.stop);
  const m = await makeUser(s, { email: 'm@x.test', name: 'm' });
  for (let i = 1; i <= 5; i++) await m.post('/chat', { text: 'm' + i });
  const page = (await m.get('/chat?limit=2')).body.messages;
  assert.deepEqual(page.map((x) => x.text), ['m5', 'm4']);
  const next = (await m.get(`/chat?limit=2&before=${page[1].id}`)).body.messages;
  assert.deepEqual(next.map((x) => x.text), ['m3', 'm2']);
  assert.equal((await m.post('/chat', { text: '  ' })).status, 400);
});
