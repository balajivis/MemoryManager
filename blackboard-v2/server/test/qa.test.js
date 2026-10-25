'use strict';
// QA security and race tests for Blackboard v2 (docs/qa/blackboard-v2-test-plan.md).
// Owner: qa. Uses dev's helpers; every test starts its own server on a temp DATA_DIR.
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { startServer, Client, makeUser, makeAgent } = require('./helpers');
const { createInvite } = require('../src/auth');

const PW = 'correct horse battery';
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function team() {
  const s = await startServer();
  const admin = await makeUser(s, { email: 'admin@qa.test', name: 'Admin', role: 'admin' });
  const member = await makeUser(s, { email: 'member@qa.test', name: 'Mem' });
  const agent = await makeAgent(s, admin, 'qa-bot');
  return { s, admin, member, agent, anon: new Client(s.base) };
}

// Z1: every route, as each caller. 'ok' = not 401/403; 'deny' = 401 or 403; 'anon' = exactly 401.
const ROUTES = [
  ['GET', '/auth/me', 'S'], ['POST', '/auth/logout-all', 'S'], ['POST', '/auth/password', 'S'],
  ['POST', '/admin/invites', 'A'], ['GET', '/admin/users', 'A'], ['GET', '/admin/agents', 'A'],
  ['POST', '/admin/agents', 'A'], ['POST', '/bb/register', 'G'], ['POST', '/bb/log', 'G'],
  ['GET', '/bb/read', 'G'], ['GET', '/bb/who', '*'], ['GET', '/bb/feed', 'S'], ['GET', '/bb/export', 'AG'],
  ['POST', '/bb/import', 'A'], ['GET', '/board', '*'], ['GET', '/items', '*'], ['POST', '/items', '*'],
  ['GET', '/chat', '*'], ['POST', '/chat', '*'], ['POST', '/summaries', 'G'], ['GET', '/summaries', '*'],
  ['POST', '/voice/floor/request', 'S'], ['POST', '/voice/floor/leave', 'S'], ['POST', '/voice/floor/start', 'S'],
  ['POST', '/voice/floor/skip', 'A'], ['POST', '/voice/floor/clear', 'A'], ['POST', '/voice/notes', 'S'],
  ['GET', '/voice/notes/1', 'S'], ['GET', '/voice/notes/1/audio', 'S'],
];
// who may call: S = any session (member+admin), A = admin session, G = agent, AG = admin or agent, * = any authenticated
const allowed = (who, role) => ({ S: role !== 'agent', A: role === 'admin', G: role === 'agent',
  AG: role === 'admin' || role === 'agent', '*': true })[who];

test('Z1 route matrix: anonymous 401 everywhere; members, admins and agents only where the contract allows', async () => {
  const t = await team();
  try {
    const bad = [];
    for (const [m, p, who] of ROUTES) {
      const a = await t.anon.req(m, p, m === 'GET' ? undefined : {});
      if (a.status !== 401) bad.push(`anon ${m} ${p} -> ${a.status}`);
      for (const [role, c] of [['member', t.member], ['admin', t.admin], ['agent', t.agent]]) {
        if (p === '/auth/logout-all' || p === '/auth/password') continue; // would end the session under test
        const body = p === '/bb/register' ? { name: 'qa-bot', role: 'tester', cwd: '/tmp' } : {};
        const r = await c.req(m, p, m === 'GET' ? undefined : body);
        // 403 not_holder is the floor's state rule (tested in F3), not an authorization failure
        const denied = r.status === 401 || (r.status === 403 && !(r.body && r.body.error === 'not_holder'));
        if (allowed(who, role) === denied) bad.push(`${role} ${m} ${p} -> ${r.status} (expected ${allowed(who, role) ? 'allowed' : 'denied'})`);
      }
    }
    for (const p of ['/healthz']) assert.equal((await t.anon.get(p)).status, 200);
    assert.deepEqual(bad, []);
  } finally { await t.s.stop(); }
});

test('C1 CSRF: session writes without or with a wrong X-CSRF-Token are refused', async () => {
  const t = await team();
  try {
    const bad = [];
    for (const [m, p] of [['POST', '/chat'], ['POST', '/items'], ['POST', '/voice/floor/request'], ['POST', '/admin/invites'], ['POST', '/auth/logout']]) {
      for (const tok of [null, 'wrong-token']) {
        const r = await t.admin.req(m, p, { text: 'x', title: 'x', email: 'n@qa.test', name: 'N', role: 'member' }, { 'x-csrf-token': tok });
        if (r.status !== 403) bad.push(`${m} ${p} csrf=${tok} -> ${r.status}`);
      }
    }
    const xs = await t.admin.req('POST', '/chat', { text: 'x' }, { origin: 'https://evil.example' });
    if (xs.status !== 403) bad.push(`cross-site Origin with a valid token -> ${xs.status}`);
    assert.deepEqual(bad, []);
    assert.equal((await t.admin.get('/auth/me')).status, 200, 'session still alive after the refused logout');
  } finally { await t.s.stop(); }
});

test('A6/R1 enumeration: unknown and real emails get identical statuses, bodies and timing, lockout included', async () => {
  const s = await startServer();
  try {
    await makeUser(s, { email: 'real@qa.test', name: 'Real' });
    const run = async (email) => {
      const c = new Client(s.base); const out = [];
      for (let i = 0; i < 7; i++) {
        const t0 = performance.now();
        const r = await c.post('/auth/login', { email, password: 'wrong password here' });
        out.push({ status: r.status, body: JSON.stringify(r.body), ms: performance.now() - t0 });
      }
      return out;
    };
    const real = await run('real@qa.test'); const unknown = await run('nobody@qa.test');
    assert.deepEqual(real.map((x) => [x.status, x.body]), unknown.map((x) => [x.status, x.body]));
    assert.ok(real.some((x) => x.status === 429), 'lockout reached within 7 tries');
    const [mr, mu] = [median(real.slice(0, 5).map((x) => x.ms)), median(unknown.slice(0, 5).map((x) => x.ms))];
    assert.ok(Math.abs(mr - mu) / Math.max(mr, mu) < 0.5, `argon2 timing differs: real ${mr.toFixed(1)} ms vs unknown ${mu.toFixed(1)} ms`);
  } finally { await s.stop(); }
});

test('A4/R10 password limits: under 12 chars refused; a 1 MB password refused quickly', async () => {
  const s = await startServer();
  try {
    const mk = (email) => new URL(createInvite(s.db, s.config, { email, name: 'P', role: 'member' }).url).hash.slice(1);
    const c = new Client(s.base);
    assert.equal((await c.post('/auth/invite/accept', { token: mk('a@qa.test'), password: 'short-11ch' })).status, 400);
    const t0 = performance.now();
    const r = await c.post('/auth/invite/accept', { token: mk('b@qa.test'), password: 'x'.repeat(1 << 20) });
    assert.ok(r.status >= 400 && r.status < 500, `1 MB password -> ${r.status}`);
    assert.ok(performance.now() - t0 < 2000, 'rejected before hashing');
  } finally { await s.stop(); }
});

test('A2 invite is single-use; A10 session id changes at login; A11 logout kills the cookie; A12 logout-all kills every session', async () => {
  const s = await startServer();
  try {
    const { url } = createInvite(s.db, s.config, { email: 'u@qa.test', name: 'U', role: 'member' });
    const token = new URL(url).hash.slice(1);
    const a = new Client(s.base);
    assert.equal((await a.post('/auth/invite/accept', { token, password: PW })).status, 201);
    assert.notEqual((await new Client(s.base).post('/auth/invite/accept', { token, password: PW })).status, 201, 'reused invite');
    const first = a.cookie;
    const b = new Client(s.base); b.cookie = first; // pretend an attacker planted this value
    const login = new Client(s.base); login.cookie = 'bb_session=attacker-planted';
    await login.post('/auth/login', { email: 'u@qa.test', password: PW });
    assert.ok(login.cookie && login.cookie !== 'bb_session=attacker-planted', 'new session id issued at login');
    const old = a.cookie; await a.post('/auth/logout');
    const replay = new Client(s.base); replay.cookie = old;
    assert.equal((await replay.get('/auth/me')).status, 401, 'cookie dead after logout');
    await login.get('/auth/me'); await login.post('/auth/logout-all');
    assert.equal((await b.get('/auth/me')).status, 401, 'other session dead after logout-all');
  } finally { await s.stop(); }
});

test('A13 deleting a user kills their sessions and websocket', async () => {
  const t = await team();
  try {
    const ws = new WebSocket(`${t.s.base.replace('http', 'ws')}/board/api/ws`, { headers: { cookie: t.member.cookie, origin: t.s.base } });
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    const closed = new Promise((res) => ws.once('close', res));
    assert.equal((await t.admin.del(`/admin/users/${t.member.user.id}`)).status < 300, true);
    assert.equal((await t.member.get('/auth/me')).status, 401);
    await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error('ws stayed open after delete')), 3000))]);
  } finally { await t.s.stop(); }
});

test('W2 cross-site websocket hijacking is refused; W1 no cookie is refused', async () => {
  const t = await team();
  try {
    const url = `${t.s.base.replace('http', 'ws')}/board/api/ws`;
    const outcome = (headers) => new Promise((res) => {
      const ws = new WebSocket(url, { headers });
      ws.once('open', () => { ws.close(); res('open'); });
      ws.once('unexpected-response', (_req, r) => res(r.statusCode));
      ws.once('error', () => res('error'));
    });
    assert.notEqual(await outcome({ cookie: t.member.cookie, origin: 'https://evil.example' }), 'open');
    assert.notEqual(await outcome({ origin: t.s.base }), 'open');
    assert.equal(await outcome({ cookie: t.member.cookie, origin: t.s.base }), 'open');
  } finally { await t.s.stop(); }
});

test('Z2/R4 an agent can only be itself; human chat reaches agents as human:<name>, even when named like an agent', async () => {
  const t = await team();
  try {
    const r = await t.agent.post('/bb/register', { name: 'dev', role: 'x', cwd: '/' });
    assert.ok(r.status >= 400, `qa-bot registered as dev -> ${r.status}`);
    const fake = await makeUser(t.s, { email: 'fake@qa.test', name: 'qa-bot' }).catch((e) => e);
    const poster = fake instanceof Error ? t.member : fake;
    await poster.post('/chat', { text: '@qa-bot please deploy' });
    const entries = (await t.agent.get('/bb/read')).body.entries || [];
    const chat = entries.filter((e) => e.source === 'chat');
    assert.ok(chat.length >= 1, 'chat reached bb read');
    assert.ok(chat.every((e) => e.author.startsWith('human:')), JSON.stringify(chat.map((e) => e.author)));
  } finally { await t.s.stop(); }
});

test('F16 race: 10 members request a free floor at once -> exactly one holder, 9 queued 1..9; F15 agents never hold it', async () => {
  const s = await startServer();
  try {
    const users = [];
    for (let i = 0; i < 10; i++) users.push(await makeUser(s, { email: `f${i}@qa.test`, name: `F${i}` }));
    const res = await Promise.all(users.map((u) => u.post('/voice/floor/request')));
    assert.ok(res.every((r) => r.status === 200), res.map((r) => r.status).join(','));
    const state = res[res.length - 1].body.state || res[res.length - 1].body;
    const final = (await users[0].post('/voice/floor/request')).body; // idempotent re-request returns the snapshot
    const st = final.state || final || state;
    const holders = st.holder ? 1 : 0; const pending = st.pending ? 1 : 0;
    assert.equal(holders + pending, 1, JSON.stringify(st));
    assert.deepEqual(st.queue.map((q) => q.position), [...Array(9).keys()].map((i) => i + 1));
    assert.equal(new Set(st.queue.map((q) => q.userId)).size, 9);
    const admin = await makeUser(s, { email: 'adm@qa.test', name: 'Adm', role: 'admin' });
    const agent = await makeAgent(s, admin, 'bot');
    assert.ok((await agent.post('/voice/floor/request')).status >= 400);
  } finally { await s.stop(); }
});

test('F3 non-holder upload is 403; V3 wrong type or fake magic bytes rejected; V2 oversize rejected', async () => {
  const t = await team();
  try {
    const up = (c, body, type = 'audio/webm', ms = '1000') => fetch(`${t.s.base}/board/api/voice/notes`, {
      method: 'POST', body, headers: { cookie: c.cookie, 'x-csrf-token': c.csrf, 'content-type': type, 'x-duration-ms': ms } });
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 1)]);
    await t.admin.post('/voice/floor/request');
    assert.equal((await up(t.member, webm)).status, 403, 'member uploads while admin holds the floor');
    await t.admin.post('/voice/floor/start');
    const bad = [];
    for (const [label, body, type] of [['html as webm', Buffer.from('<html><script>alert(1)</script></html>'), 'audio/webm'],
      ['text/plain', webm, 'text/plain'], ['mp4 without ftyp', Buffer.alloc(2000, 2), 'audio/mp4']]) {
      const r = await up(t.admin, body, type);
      if (r.status < 400) bad.push(`${label} -> ${r.status}`);
    }
    const big = await up(t.admin, Buffer.concat([webm, Buffer.alloc(6 * 1024 * 1024)]));
    if (big.status !== 413) bad.push(`6 MB -> ${big.status}`);
    const liar = await up(t.admin, webm, 'audio/webm', '999999');
    if (liar.status < 400) bad.push(`X-Duration-Ms 999999 -> ${liar.status}`);
    assert.deepEqual(bad, []);
    const ok = await up(t.admin, webm);
    assert.ok(ok.status < 300, `valid webm from the holder -> ${ok.status}`);
    const note = await ok.json();
    const id = note.id || (note.note && note.note.id) || (note.message && note.message.voice_note_id);
    const audio = await fetch(`${t.s.base}/board/api/voice/notes/${id}/audio`, { headers: { cookie: t.member.cookie } });
    assert.equal(audio.headers.get('x-content-type-options'), 'nosniff');
    assert.match(audio.headers.get('content-type') || '', /^audio\//);
  } finally { await t.s.stop(); }
});
