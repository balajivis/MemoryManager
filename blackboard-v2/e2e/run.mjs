// End-to-end checks for Blackboard v2 against a running dev stack (see ../dev.sh). Node built-ins + `ws` from server/node_modules.
// Env: E2E_BASE (default from ../.dev-state.json or http://127.0.0.1:8780), E2E_DATA_DIR (to create an admin via the CLI).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const { WebSocket } = createRequire(path.join(ROOT, 'server', 'package.json'))('ws');

let state = {};
try { state = JSON.parse(fs.readFileSync(path.join(ROOT, '.dev-state.json'), 'utf8')); } catch { /* optional */ }
const BASE = (process.env.E2E_BASE || state.base || 'http://127.0.0.1:8780').replace(/\/$/, '');
const DATA_DIR = process.env.E2E_DATA_DIR || state.dataDir;
const API = `${BASE}/board/api`;
const WSURL = API.replace(/^http/, 'ws') + '/ws';
const RUN = Date.now().toString(36);
const PW = 'correct-horse-battery-9';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// minimal valid EBML header + empty Segment
function tinyWebm() {
  const el = (id, data) => Buffer.concat([Buffer.from(id, 'hex'), Buffer.from([0x80 | data.length]), data]);
  const u = (n) => Buffer.from([n]);
  const header = Buffer.concat([el('4286', u(1)), el('42f7', u(1)), el('42f2', u(4)), el('42f3', u(8)),
    el('4282', Buffer.from('webm')), el('4287', u(4)), el('4285', u(2))]);
  const seg = Buffer.concat([Buffer.from('18538067', 'hex'), Buffer.from('01ffffffffffffff', 'hex')]);
  return Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.from([0x80 | header.length]), header, seg]);
}
const WEBM = tinyWebm();

class Client {
  constructor(label) { this.label = label; this.cookie = ''; this.csrf = ''; this.user = null; }
  async req(method, p, body, { headers = {}, raw = false, csrf = true } = {}) {
    const h = { ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (this.csrf && csrf && method !== 'GET') h['X-CSRF-Token'] = this.csrf;
    let payload;
    if (body !== undefined) {
      if (raw) payload = body;
      else { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    }
    const res = await fetch(API + p, { method, headers: h, body: payload });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const sess = sc.map((c) => c.split(';')[0]).find((c) => c.startsWith('bb_session='));
    if (sess) this.cookie = sess;
    const buf = Buffer.from(await res.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ }
    return { status: res.status, json, buf, headers: res.headers };
  }
  async acceptInvite(token, password = PW) {
    const r = await this.req('POST', '/auth/invite/accept', { token, password });
    if (r.status !== 201) throw new Error(`invite accept ${r.status} ${r.buf}`);
    this.csrf = r.json.csrf; this.user = r.json.user;
    return r;
  }
  async login(email, password = PW) {
    const r = await this.req('POST', '/auth/login', { email, password }, { csrf: false });
    if (r.status === 200) { this.csrf = r.json.csrf; this.user = r.json.user; }
    return r;
  }
  sock() { return new Sock(this); }
}

class Sock {
  constructor(client) {
    this.msgs = [];
    this.ws = new WebSocket(WSURL, { headers: { Cookie: client.cookie } });
    this.ws.on('message', (d) => { try { this.msgs.push({ ...JSON.parse(d), at: Date.now() }); } catch { /* ignore */ } });
    this.closed = new Promise((r) => this.ws.on('close', r));
    this.ready = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
  }
  mark() { return this.msgs.length; }
  async wait(pred, ms = 3000, from = 0) {
    const end = Date.now() + ms;
    for (;;) {
      const m = this.msgs.slice(from).find(pred);
      if (m) return m;
      if (Date.now() > end) throw new Error('timeout waiting for ws message');
      await sleep(20);
    }
  }
  close() { this.ws.close(); }
}

// ---- tiny runner
const results = [];
async function check(name, fn) {
  try { await fn(); results.push([true, name]); console.log(`PASS  ${name}`); }
  catch (e) { results.push([false, name]); console.log(`FAIL  ${name}\n      ${e.message}`); }
}
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what || 'value'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c, what) => { if (!c) throw new Error(what); };

// ---- setup helpers
function tokenOf(url) { return new URL(url).searchParams.get('token') || url.split('token=')[1] || url.split('#')[1]; }

async function makeAdmin() {
  ok(DATA_DIR, 'no DATA_DIR: run ./dev.sh first (writes .dev-state.json) or set E2E_DATA_DIR');
  const email = `e2e-admin-${RUN}@example.test`;
  const out = execFileSync('node', ['src/cli.js', 'create-admin', email, `E2EAdmin${RUN}`],
    { cwd: path.join(ROOT, 'server'), env: { ...process.env, DATA_DIR, PUBLIC_URL: BASE }, encoding: 'utf8' }).trim();
  const c = new Client('admin');
  await c.acceptInvite(tokenOf(out.split('\n').pop()));
  c.email = email;
  return c;
}
async function makeMember(admin, tag) {
  const email = `e2e-${tag}-${RUN}@example.test`.toLowerCase(), name = `E2E${tag}${RUN}`;
  const r = await admin.req('POST', '/admin/invites', { email, name, role: 'member' });
  if (r.status !== 201) throw new Error(`create invite ${r.status} ${r.buf}`);
  const c = new Client(tag);
  c.email = email; c.inviteToken = tokenOf(r.json.url); c.name = name;
  return c;
}
async function makeAgent(admin, tag) {
  const name = `e2e-${tag}-${RUN}`;
  const r = await admin.req('POST', '/admin/agents', { name, role: `e2e ${tag}` });
  if (r.status !== 201) throw new Error(`create agent ${r.status} ${r.buf}`);
  const c = new Client(tag); c.token = r.json.token; c.name = name;
  return c;
}

console.log(`Blackboard v2 e2e against ${BASE} (run ${RUN})\n`);

// 1. logged out
await check('logged-out: healthz is public', async () => {
  eq((await new Client().req('GET', '/healthz')).status, 200, 'status');
});
await check('logged-out: every API route returns 401', async () => {
  const anon = new Client();
  const routes = [['GET', '/auth/me'], ['GET', '/bb/who'], ['GET', '/bb/feed'], ['GET', '/bb/read'], ['GET', '/board'], ['GET', '/items'],
    ['GET', '/chat'], ['GET', '/summaries'], ['GET', '/admin/users'], ['GET', '/admin/agents'], ['GET', '/voice/notes/1'],
    ['GET', '/voice/notes/1/audio'], ['POST', '/chat', { text: 'x' }], ['POST', '/bb/log', { kind: 'obs', text: 'x' }],
    ['POST', '/voice/floor/request', {}], ['POST', '/voice/floor/skip', {}], ['POST', '/voice/notes', Buffer.from('x'), true],
    ['POST', '/admin/invites', { email: 'a@b.c', name: 'x' }], ['PUT', '/board/directive', { text: 'x' }], ['POST', '/items', { title: 'x' }]];
  const bad = [];
  for (const [m, p, b, raw] of routes) {
    const r = await anon.req(m, p, b, raw ? { raw: true, headers: { 'Content-Type': 'audio/webm' } } : {});
    if (r.status !== 401) bad.push(`${m} ${p} -> ${r.status}`);
  }
  ok(!bad.length, bad.join('; '));
});
await check('logged-out: WebSocket upgrade refused', async () => {
  const ws = new WebSocket(WSURL);
  const outcome = await new Promise((res) => { ws.on('open', () => res('open')); ws.on('error', (e) => res(e.message)); });
  ws.terminate();
  ok(outcome !== 'open' && /401/.test(outcome), `expected 401 refusal, got: ${outcome}`);
});

// 2. invite, login, lockout
let admin, A, B, C, L;
await check('admin: create via CLI and accept invite', async () => { admin = await makeAdmin(); eq(admin.user.role, 'admin', 'role'); });
await check('invite: GET shows email/name, POST sets password, session works', async () => {
  A = await makeMember(admin, 'A');
  const g = await new Client().req('POST', '/auth/invite/lookup', { token: A.inviteToken });
  eq(g.status, 200, 'GET invite'); eq(g.json.email, A.email, 'invite email');
  const short = await new Client().req('POST', '/auth/invite/accept', { token: A.inviteToken, password: 'short' });
  eq(short.status, 400, 'short password');
  await A.acceptInvite(A.inviteToken);
  const me = await A.req('GET', '/auth/me');
  eq(me.status, 200, '/auth/me'); eq(me.json.user.email, A.email, 'me.email'); ok(me.json.csrf, 'csrf in body');
});
await check('invite: single use (reuse refused)', async () => {
  const r = await new Client().req('POST', '/auth/invite/accept', { token: A.inviteToken, password: PW });
  ok(r.status >= 400 && r.status < 500, `expected 4xx, got ${r.status}`);
});
await check('invited user appears in roster', async () => {
  const r = await A.req('GET', '/board');
  eq(r.status, 200, 'GET /board'); ok(JSON.stringify(r.json.roster).includes(A.name), `roster lacks ${A.name}: ${JSON.stringify(r.json.roster)}`);
});
await check('session cookie flags: HttpOnly, SameSite=Lax, Path=/board', async () => {
  const res = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: A.email, password: PW }) });
  const sc = res.headers.getSetCookie().find((c) => c.startsWith('bb_session='));
  ok(sc && /HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc) && /Path=\/board(;|$)/.test(sc), `Set-Cookie: ${sc}`);
});
await check('login: wrong password 401, right password 200, logout kills session', async () => {
  const c = new Client();
  eq((await c.login(A.email, 'wrong-password-xx')).status, 401, 'wrong pw');
  eq((await c.login(A.email)).status, 200, 'right pw');
  eq((await c.req('POST', '/auth/logout', {})).status, 200, 'logout');
  eq((await c.req('GET', '/auth/me')).status, 401, 'after logout');
});
await check('CSRF: session write without X-CSRF-Token is 403', async () => {
  eq((await A.req('POST', '/chat', { text: 'x' }, { csrf: false })).status, 403, 'status');
});
await check('lockout: 5 wrong passwords then correct password is 429', async () => {
  L = await makeMember(admin, 'L'); await L.acceptInvite(L.inviteToken);
  const c = new Client();
  for (let i = 0; i < 5; i++) eq((await c.login(L.email, 'wrong-password-xx')).status, 401, `attempt ${i + 1}`);
  eq((await c.login(L.email)).status, 429, 'correct pw while locked');
});

// 3. chat
B = await makeMember(admin, 'B'); C = await makeMember(admin, 'C');
await B.acceptInvite(B.inviteToken); await C.acceptInvite(C.inviteToken);
const sA = A.sock(), sB = B.sock(), sC = C.sock(), sAdmin = admin.sock();
await Promise.all([sA.ready, sB.ready, sC.ready, sAdmin.ready]);

await check('chat: delivered to a second WS client in < 2 s', async () => {
  const text = `hello ${RUN}`, from = sB.mark(), t0 = Date.now();
  eq((await A.req('POST', '/chat', { text })).status, 201, 'POST /chat');
  const m = await sB.wait((x) => x.type === 'chat' && x.message && x.message.text === text, 2000, from);
  ok(m.at - t0 < 2000, `took ${m.at - t0} ms`);
  const hist = await B.req('GET', '/chat');
  ok(hist.json.messages.some((x) => x.text === text), 'message missing from GET /chat');
});

// 4. floor
await admin.req('POST', '/voice/floor/clear', {});
for (let i = 0; i < 3; i++) await admin.req('POST', '/voice/floor/skip', {});
const floorOf = (r) => (r.json && (r.json.state || r.json));
const upload = (c, buf = WEBM, ms = 1000, type = 'audio/webm') =>
  c.req('POST', '/voice/notes', buf, { raw: true, headers: { 'Content-Type': type, 'X-Duration-Ms': String(ms) } });

await check('floor: A requests a free floor and holds it at once', async () => {
  const r = await A.req('POST', '/voice/floor/request', {});
  eq(r.status, 200, 'status'); eq(floorOf(r).holder && floorOf(r).holder.userId, A.user.id, 'holder');
});
await check('floor: B and C are queued at positions 1 and 2', async () => {
  const rb = floorOf(await B.req('POST', '/voice/floor/request', {}));
  eq(rb.queue.length, 1, 'queue len'); eq(rb.queue[0].userId, B.user.id, 'B first'); eq(rb.queue[0].position, 1, 'position');
  const rc = floorOf(await C.req('POST', '/voice/floor/request', {}));
  eq(rc.queue[1].userId, C.user.id, 'C second');
});
await check('floor: B direct upload is 403 not_holder', async () => {
  const r = await upload(B);
  eq(r.status, 403, 'status'); eq(r.json && r.json.error, 'not_holder', 'error');
});
await check('floor: agent cannot request the floor (403)', async () => {
  const ag = await makeAgent(admin, 'fl');
  eq((await ag.req('POST', '/voice/floor/request', {})).status, 403, 'status');
});
await check('floor: member cannot skip or clear (403)', async () => {
  eq((await B.req('POST', '/voice/floor/skip', {})).status, 403, 'skip');
  eq((await B.req('POST', '/voice/floor/clear', {})).status, 403, 'clear');
});
let turnBAt = 0;
await check('floor: A posts, B is offered the floor within 1 s', async () => {
  const from = sB.mark();
  const r = await upload(A);
  eq(r.status, 201, `A upload (${r.buf.toString().slice(0, 100)})`);
  const t1 = Date.now();
  const m = await sB.wait((x) => x.type === 'floor_turn', 2000, from);
  turnBAt = m.at;
  ok(m.at - t1 < 1000, `floor_turn ${m.at - t1} ms after A's response`);
  const snap = await sB.wait((x) => x.type === 'floor' && x.state && x.state.pending && x.state.pending.userId === B.user.id, 1000, from);
  ok(snap, 'no floor snapshot with B pending');
});
await check('floor: B does not start in 15 s, is skipped to the back; C is offered', async () => {
  const from = sC.mark();
  const m = await sC.wait((x) => x.type === 'floor_turn', 18000, from);
  const waited = m.at - turnBAt;
  ok(waited > 14000 && waited < 17500, `skip took ${waited} ms after B's offer`);
  const s = floorOf(await C.req('POST', '/voice/floor/request', {})); // idempotent snapshot
  eq(s.pending && s.pending.userId, C.user.id, 'pending');
  eq(s.queue[0] && s.queue[0].userId, B.user.id, 'B back in queue');
});
await check('floor: C starts, then C disconnecting releases the floor', async () => {
  eq((await C.req('POST', '/voice/floor/start', {})).status, 200, 'start');
  const from = sB.mark();
  sC.close();
  await sB.wait((x) => x.type === 'floor' && x.state && (!x.state.holder || x.state.holder.userId !== C.user.id), 7000, from);
});
await check('floor: admin skip removes the holder', async () => {
  const s0 = floorOf(await B.req('POST', '/voice/floor/start', {})); // B was offered after C left
  eq(s0 && s0.holder && s0.holder.userId, B.user.id, 'B holds');
  const s = floorOf(await admin.req('POST', '/voice/floor/skip', {}));
  ok(!s.holder || s.holder.userId !== B.user.id, 'B still holder');
});
await check('floor: admin clear empties the queue', async () => {
  await admin.req('POST', '/voice/floor/clear', {});
  await A.req('POST', '/voice/floor/request', {});
  await B.req('POST', '/voice/floor/request', {});
  const r = await admin.req('POST', '/voice/floor/clear', {});
  eq(r.status, 200, 'status'); eq(floorOf(r).queue.length, 0, 'queue len');
  await admin.req('POST', '/voice/floor/skip', {});
  await A.req('POST', '/voice/floor/leave', {}); await B.req('POST', '/voice/floor/leave', {});
});

// 5. voice upload
await check('voice: bad content rejected, tiny webm accepted, transcript status settles, audio served with Range', async () => {
  const s = floorOf(await A.req('POST', '/voice/floor/request', {}));
  eq(s.holder && s.holder.userId, A.user.id, 'A holds');
  const bad = await upload(A, Buffer.from('<html>not audio</html>'));
  ok(bad.status === 415 || bad.status === 400, `non-webm body gave ${bad.status}`);
  const from = sB.mark();
  const up = await upload(A);
  eq(up.status, 201, 'upload'); const id = up.json.id; ok(id, 'no id');
  const m = await sB.wait((x) => x.type === 'chat' && x.message && x.message.voice_note_id === id, 2000, from);
  ok(m, 'no chat message for voice note');
  let note;
  for (let i = 0; i < 60; i++) { note = (await A.req('GET', `/voice/notes/${id}`)).json; if (note.status !== 'pending') break; await sleep(500); }
  ok(note.status !== 'pending', 'status still pending after 30 s');
  ok(['done', 'disabled', 'failed'].includes(note.status), `status ${note.status}`);
  const full = await A.req('GET', `/voice/notes/${id}/audio`);
  eq(full.status, 200, 'audio'); ok(full.buf.equals(WEBM), 'audio bytes differ');
  ok(/audio\/(webm|mp4)/.test(full.headers.get('content-type')), 'content-type');
  const part = await A.req('GET', `/voice/notes/${id}/audio`, undefined, { headers: { Range: 'bytes=0-3' } });
  eq(part.status, 206, 'range'); ok(part.buf.equals(WEBM.subarray(0, 4)), 'range bytes');
  eq((await upload(A)).status, 403, 'second upload after floor released');
});

// 6. agent token bb log/read
await check('bb: agent log/read cursor semantics', async () => {
  const X = await makeAgent(admin, 'x'), Y = await makeAgent(admin, 'y');
  eq((await X.req('POST', '/bb/register', { name: X.name, role: 'e2e', cwd: '/tmp' })).status, 200, 'register X');
  eq((await Y.req('POST', '/bb/register', { name: Y.name, role: 'e2e', cwd: '/tmp' })).status, 200, 'register Y');
  eq((await Y.req('POST', '/bb/register', { name: X.name, role: 'e2e' })).status, 403, 'register as another agent');
  const l1 = await X.req('POST', '/bb/log', { kind: 'obs', text: 'one' });
  eq(l1.status, 201, 'log 1'); eq(l1.json.seq, 1, 'seq 1');
  eq((await X.req('POST', '/bb/log', { kind: 'claim', text: 'two' })).json.seq, 2, 'seq 2');
  eq((await X.req('POST', '/bb/log', { kind: 'bogus', text: 'x' })).status, 400, 'bad kind');
  const r1 = (await Y.req('GET', '/bb/read')).json.entries.filter((e) => e.author === X.name);
  eq(r1.map((e) => e.text).join(','), 'one,two', 'Y first read, oldest first');
  eq((await Y.req('GET', '/bb/read')).json.entries.length, 0, 'Y second read is empty');
  eq((await X.req('GET', '/bb/read')).json.entries.filter((e) => e.author === X.name).length, 0, 'X never reads own entries');
  await X.req('POST', '/bb/log', { kind: 'done', text: 'three' });
  const r3 = (await Y.req('GET', '/bb/read')).json.entries;
  eq(r3.length, 1, 'Y third read count'); eq(r3[0].seq, 3, 'seq 3');
  const rp = (await Y.req('GET', '/bb/read?replay=1')).json.entries.filter((e) => e.author === X.name);
  eq(rp.length, 3, 'replay returns all');
  eq((await Y.req('GET', '/bb/read')).json.entries.length, 0, 'read after replay is empty');
  await Y.req('POST', '/bb/log', { kind: 'reply', text: 'back' });
  eq((await X.req('GET', '/bb/read')).json.entries.filter((e) => e.author === Y.name).length, 1, 'X sees Y entry');
  eq((await X.req('POST', '/bb/log', { kind: 'obs', text: 'x'.repeat(24001) })).status >= 400, true, '24,001-byte entry rejected');
});
await check('bb: human chat reaches agent via bb read (source "chat")', async () => {
  const Z = await makeAgent(admin, 'z');
  await Z.req('GET', '/bb/read');
  const text = `ping ${RUN} @${Z.name}`;
  await A.req('POST', '/chat', { text });
  const es = (await Z.req('GET', '/bb/read')).json.entries;
  ok(es.some((e) => e.text.includes(text) && e.source === 'chat'), `entries: ${JSON.stringify(es).slice(0, 300)}`);
});

[sA, sB, sAdmin].forEach((s) => s.close());
const failed = results.filter((r) => !r[0]).length;
console.log(`\n${results.length - failed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
