// Tiny mock of the Blackboard v2 API + WS (node built-ins only). Not for production.
// node dev-mock.mjs [port]  ->  http://127.0.0.1:8790/board/  (serves ./out too). Login: any email, password "password".
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.argv[2] || process.env.PORT || 8790);
const me = { id: 1, name: 'Balaji', email: 'balaji@example.com', role: 'admin' };
const CSRF = 'mock-csrf';
const now = () => new Date().toISOString();
let nextId = 10;
const chat = [
  { id: 1, author: 'pm', author_kind: 'agent', text: 'Spec is approved. @Balaji please look at the board.', voice_note_id: null, created_at: now() },
  { id: 2, author: 'Balaji', author_kind: 'human', text: 'Thanks @pm, on it.', voice_note_id: null, created_at: now() },
];
const feed = [
  { author: 'dev', seq: 2, kind: 'done', text: 'Frontend skeleton built.', created_at: now() },
  { author: 'qa', seq: 1, kind: 'ask', text: '@dev which port does the API use?', created_at: now() },
];
const board = {
  directive: 'Ship the board, then pause for review.',
  strategy: 'Own the board on our VM.',
  items: [
    { id: 1, title: 'Voice floor and queue', stage: 'built', status: '', needed: '', owner: 'dev', created_at: now(), updated_at: now() },
    { id: 2, title: 'Pick transcription vendor', stage: 'claimed', status: '', needed: 'choose OpenAI or Deepgram', owner: 'pm', created_at: now(), updated_at: now() },
    { id: 3, title: 'Login', stage: 'live', status: '', needed: '', owner: 'dev', created_at: now(), updated_at: now() },
    { id: 4, title: 'Deploy pipeline', stage: 'tested', status: 'blocked', needed: 'VM size approval', owner: 'devops', created_at: now(), updated_at: now() },
  ],
  roster: [{ name: 'Balaji', role: 'admin', kind: 'human', online: true }, { name: 'pm', role: 'product', kind: 'agent', online: true }, { name: 'dev', role: 'developer', kind: 'agent', online: false }],
  tiles: {},
};
const notes = {}; // id -> {buf, ms}
let floor = { holder: null, queue: [], pending: null };
const history = {}; // item id -> rows
const summaries = [{ day: '2026-10-24', text: 'Spec approved. Backend started.\nFrontend skeleton built.', done: [{ title: 'Spec', owner: 'pm' }], blocked: [{ title: 'Deploy pipeline', needed: 'VM size approval' }] }];
let pendTimer = null;

// --- WebSocket (minimal RFC 6455, server->client text frames) ---
const clients = new Set();
function frame(str) {
  const p = Buffer.from(str); const n = p.length;
  const h = n < 126 ? Buffer.from([0x81, n]) : Buffer.from([0x81, 126, n >> 8, n & 255]);
  return Buffer.concat([h, p]);
}
const send = (o) => { const f = frame(JSON.stringify(o)); clients.forEach((s) => s.write(f)); };

// Floor (shapes as in server/src/floor.js: numeric ms timestamps, pending {userId,expiresAt}).
function snapFloor() {
  return { holder: floor.holder, queue: floor.queue.map((q, i) => ({ userId: q.userId, name: q.name, position: i + 1 })), pending: floor.pending && { userId: floor.pending.userId, expiresAt: floor.pending.expiresAt } };
}
function push(reason, userId) { send({ type: 'floor', state: snapFloor(), reason, userId }); }
function advance() {
  if (floor.holder || floor.pending || !floor.queue.length) return;
  const u = floor.queue.shift();
  floor.pending = { ...u, expiresAt: Date.now() + 15000 };
  clearTimeout(pendTimer);
  pendTimer = setTimeout(() => { const p = floor.pending; floor.pending = null; if (floor.queue.length) floor.queue.push({ userId: p.userId, name: p.name }); advance(); push('skipped_timeout', p.userId); }, 15000);
}
function grant(u) { floor.holder = { userId: u.userId, name: u.name, grantedAt: Date.now(), deadline: Date.now() + 120000 }; }
function drop(id, reason) {
  if (floor.holder && floor.holder.userId === id) floor.holder = null;
  if (floor.pending && floor.pending.userId === id) { floor.pending = null; clearTimeout(pendTimer); }
  floor.queue = floor.queue.filter((q) => q.userId !== id);
  advance(); push(reason, id);
}
const dayItems = (key) => {
  const open = board.items.filter((i) => i.stage !== 'live');
  return { blocked: open.filter((i) => i.status === 'blocked' || i.needed), in_progress: open, delivered: board.items.filter((i) => i.stage === 'live'), live: board.items.filter((i) => i.stage === 'live'), all: board.items }[key];
};
const logHist = (it, by) => (history[it.id] = history[it.id] || []).push({ at: now(), stage: it.stage, status: it.status, by });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (!p.startsWith('/board/api/')) {
    // static export
    let f = p.replace(/^\/board\/?/, '');
    if (p === '/') { res.writeHead(302, { Location: '/board/' }); return res.end(); }
    let file = path.join('out', f);
    if (!path.extname(file)) file = path.join(file, 'index.html');
    fs.readFile(file, (e, d) => {
      if (e) { res.writeHead(404); return res.end('not found'); }
      const t = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': t }); res.end(d);
    });
    return;
  }
  const r = p.slice('/board/api'.length);
  const authed = /bb_session=ok/.test(req.headers.cookie || '');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    let body = {}; try { body = JSON.parse(raw.toString() || '{}'); } catch {}
    const m = req.method;
    if (r === '/auth/login' && m === 'POST') {
      if (body.password !== 'password') return json(401, { error: 'invalid', message: 'Wrong email or password' });
      res.setHeader('Set-Cookie', 'bb_session=ok; Path=/board; HttpOnly; SameSite=Lax'); return json(200, { ok: true });
    }
    if (r === '/auth/invite/lookup') return json(200, { email: 'new@example.com', name: 'New Person' });
    if (r === '/auth/invite/accept') return json(201, { ok: true });
    if (r === '/healthz') return json(200, { ok: true });
    if (!authed) return json(401, { error: 'unauthorized', message: 'Sign in' });
    if (m !== 'GET' && req.headers['x-csrf-token'] !== CSRF && !r.startsWith('/_mock')) return json(403, { error: 'csrf', message: 'Bad CSRF token' });

    if (r === '/auth/me') return json(200, { user: me, csrf: CSRF });
    if (r === '/auth/logout' || r === '/auth/logout-all') { res.setHeader('Set-Cookie', 'bb_session=; Path=/board; Max-Age=0'); return json(200, {}); }
    if (r === '/board' && m === 'GET') return json(200, board);
    const tl = r.match(/^\/board\/tiles\/(\w+)$/);
    if (tl) { const items = dayItems(tl[1]); if (!items) return json(404, { error: 'not_found', message: 'no such tile' }); return json(200, { tile: tl[1], title: tl[1], items, entries: feed.slice(0, 5) }); }
    if (r === '/board/directive' || r === '/board/strategy') {
      board[r.split('/')[2]] = body.text; send({ type: 'board', board }); return json(200, { text: body.text });
    }
    if (r === '/items' && m === 'POST') { const it = { id: nextId++, status: '', needed: '', owner: '', ...body, created_at: now(), updated_at: now() }; board.items.push(it); logHist(it, me.name); send({ type: 'board', board }); return json(201, it); }
    const pm = r.match(/^\/items\/(\d+)$/);
    if (pm && m === 'GET') { const it = board.items.find((i) => i.id === +pm[1]); if (!it) return json(404, { error: 'not_found', message: 'no such item' }); return json(200, { item: it, history: history[it.id] || [], entries: feed.slice(0, 3) }); }
    if (pm && m === 'PATCH') { const it = board.items.find((i) => i.id === +pm[1]); Object.assign(it || {}, body, { updated_at: now() }); logHist(it, me.name); send({ type: 'board', board }); return json(200, it); }
    if (r === '/chat' && m === 'GET') {
      const before = Number(url.searchParams.get('before') || 1e9);
      return json(200, { messages: chat.filter((c) => c.id < before).slice(-50).reverse() });
    }
    if (r === '/chat' && m === 'POST') {
      const msg = { id: nextId++, author: me.name, author_kind: 'human', text: body.text, voice_note_id: null, created_at: now() };
      chat.push(msg); send({ type: 'chat', message: msg });
      if (/@pm/.test(body.text)) setTimeout(() => { const a = { id: nextId++, author: 'pm', author_kind: 'agent', text: 'Noted: ' + body.text, voice_note_id: null, created_at: now() }; chat.push(a); send({ type: 'chat', message: a }); }, 800);
      return json(201, { message: msg });
    }
    if (r === '/bb/feed') return json(200, { entries: feed });
    if (r.startsWith('/voice/floor/')) {
      const a = r.split('/')[3];
      const mine = floor.holder && floor.holder.userId === me.id;
      const u = { userId: me.id, name: me.name };
      const has = mine || (floor.pending && floor.pending.userId === me.id) || floor.queue.some((q) => q.userId === me.id);
      if (a === 'request') { if (!has) { if (!floor.holder && !floor.pending) grant(u); else floor.queue.push(u); } push(); }
      else if (a === 'leave') drop(me.id, mine ? 'cancelled' : undefined);
      else if (a === 'skip') { if (body.userId) drop(body.userId, 'admin_skip'); else if (floor.holder) drop(floor.holder.userId, 'admin_skip'); else if (floor.pending) drop(floor.pending.userId, 'admin_skip'); }
      else if (a === 'clear') { floor.queue = []; push('admin_clear'); }
      else if (a === 'start') { if (!(floor.pending && floor.pending.userId === me.id)) return json(409, { error: 'not_pending' }); floor.pending = null; clearTimeout(pendTimer); grant(u); push(); }
      return json(200, { state: snapFloor() });
    }
    if (r === '/voice/notes' && m === 'POST') {
      if (!(floor.holder && floor.holder.userId === me.id)) return json(403, { error: 'not_holder', message: 'You do not hold the floor' });
      const id = nextId++; notes[id] = { buf: raw, ms: Number(req.headers['x-duration-ms']) };
      drop(me.id, 'posted');
      const msg = { id: nextId++, author: me.name, author_kind: 'human', text: '', voice_note_id: id, created_at: now() };
      chat.push(msg); send({ type: 'chat', message: msg });
      setTimeout(() => send({ type: 'voice', id, status: 'done', transcript: 'Mock transcript of ' + raw.length + ' bytes.' }), 1500);
      return json(200, { id });
    }
    const vn = r.match(/^\/voice\/notes\/(\d+)(\/audio)?$/);
    if (vn) {
      const n = notes[vn[1]]; if (!n) return json(404, { error: 'not_found', message: 'No such note' });
      if (vn[2]) { res.writeHead(200, { 'Content-Type': 'audio/webm' }); return res.end(n.buf); }
      return json(200, { id: +vn[1], duration_ms: n.ms, status: 'pending', transcript: null });
    }
    if (r === '/_mock/sam') { const u = { userId: 2, name: 'Sam' }; if (!floor.holder && !floor.pending) grant(u); else floor.queue.push(u); push(); return json(200, snapFloor()); }
    if (r === '/_mock/sam-leave') { drop(2, 'cancelled'); return json(200, snapFloor()); }
    if (r === '/summaries' && m === 'GET') return json(200, summaries);
    if (r === '/summaries' && m === 'POST') { const sm = { ...body }; const i = summaries.findIndex((x) => x.day === sm.day); if (i >= 0) summaries[i] = sm; else summaries.unshift(sm); send({ type: 'summary', summary: sm }); return json(201, sm); }
    const sd = r.match(/^\/summaries\/([\d-]+)$/);
    if (sd) { const sm = summaries.find((x) => x.day === sd[1]); return sm ? json(200, sm) : json(404, { error: 'not_found', message: 'no summary' }); }
    if (r === '/admin/users') return json(200, { users: [me, { id: 2, name: 'Sam', email: 'sam@example.com', role: 'member' }] });
    if (r === '/admin/agents' && m === 'GET') return json(200, { agents: [{ name: 'pm', role: 'product' }, { name: 'dev', role: 'developer' }] });
    if (r === '/admin/invites') return json(201, { url: 'http://127.0.0.1:' + PORT + '/board/invite/#mock' });
    if (r.startsWith('/admin/agents')) return json(201, { name: 'x', token: 'mock-token-shown-once' });
    return json(404, { error: 'not_found', message: 'mock: ' + m + ' ' + r });
  });
});

server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith('/board/api/ws') || !/bb_session=ok/.test(req.headers.cookie || '')) return socket.destroy();
  const key = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + key + '\r\n\r\n');
  clients.add(socket);
  socket.write(frame(JSON.stringify({ type: 'hello', user: me, floor: snapFloor(), online: ['Balaji', 'pm'] })));
  socket.on('data', () => {}); // client pings ignored
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
});

server.listen(PORT, '127.0.0.1', () => console.log('mock on http://127.0.0.1:' + PORT + '/board/  (password: password)'));
