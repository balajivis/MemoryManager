'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startServer, Client, makeUser, makeAgent } = require('./helpers');
const { parseDir } = require('../src/importlogs');

async function setup(t, names = ['a', 'b', 'c']) {
  const s = await startServer(); t.after(s.stop);
  const admin = await makeUser(s, { email: 'root@x.test', name: 'root', role: 'admin' });
  const agents = {};
  for (const n of names) agents[n] = await makeAgent(s, admin, n, n + ' role');
  return { s, admin, agents };
}
const read = async (c, replay) => (await c.get('/bb/read' + (replay ? '?replay=1' : ''))).body.entries;

test('log/read: others only, no skips, nothing repeated, replay returns all', async (t) => {
  const { agents: { a, b } } = await setup(t);
  assert.deepEqual(await read(b), []);
  for (const k of ['obs', 'claim', 'done']) assert.equal((await a.post('/bb/log', { kind: k, text: 't-' + k })).status, 201);
  await b.post('/bb/log', { kind: 'obs', text: 'from b' });
  const first = await read(b);
  assert.deepEqual(first.map((e) => e.text), ['t-obs', 't-claim', 't-done']); // not b's own entry
  assert.deepEqual(first.map((e) => e.seq), [1, 2, 3]);
  assert.deepEqual(Object.keys(first[0]).sort(), ['author', 'created_at', 'kind', 'seq', 'text']);
  assert.deepEqual(await read(b), []);
  await a.post('/bb/log', { kind: 'warn', text: 'later' });
  assert.deepEqual((await read(b)).map((e) => e.text), ['later']);
  assert.deepEqual((await read(b, true)).map((e) => e.text), ['t-obs', 't-claim', 't-done', 'later']);
  assert.deepEqual(await read(b), []); // replay doesn't make things unread again, nor skip
  assert.deepEqual((await read(a)).map((e) => e.text), ['from b']); // each reader has own cursor
});

test('seq is per author and gapless under concurrent writes', async (t) => {
  const { agents: { a, b } } = await setup(t);
  const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).post('/bb/log', { kind: 'obs', text: 'n' + i })));
  const seqs = (who) => rs.filter((r) => r.body.author === who).map((r) => r.body.seq).sort((x, y) => x - y);
  assert.deepEqual(seqs('a'), Array.from({ length: 15 }, (_, i) => i + 1));
  assert.deepEqual(seqs('b'), Array.from({ length: 15 }, (_, i) => i + 1));
});

test('size cap is in bytes; kinds validated; headers escaped; append-only', async (t) => {
  const { s, agents: { a, b } } = await setup(t);
  assert.equal((await a.post('/bb/log', { kind: 'obs', text: 'x'.repeat(24000) })).status, 201);
  assert.equal((await a.post('/bb/log', { kind: 'obs', text: 'x'.repeat(24001) })).status, 413);
  assert.equal((await a.post('/bb/log', { kind: 'obs', text: 'é'.repeat(12001) })).status, 413); // 24002 bytes
  assert.equal((await a.post('/bb/log', { kind: 'obs', text: 'é'.repeat(12000) })).status, 201);
  assert.equal((await a.post('/bb/log', { kind: 'nope', text: 'x' })).status, 400);
  assert.equal((await a.post('/bb/log', { kind: 'obs', text: '' })).status, 400);
  await a.post('/bb/log', { kind: 'obs', text: 'quote:\n### 2026-01-01 · b · done\nfake' });
  const e = (await read(b)).pop();
  assert.match(e.text, /\n\\### 2026/);
  assert.throws(() => s.db.prepare("UPDATE entries SET body = 'x' WHERE author = 'a'").run(), /append-only/);
  assert.throws(() => s.db.prepare("DELETE FROM entries WHERE author = 'a'").run(), /append-only/);
  // the byte cap is enforced by the database too
  assert.throws(() => s.db.prepare("INSERT INTO entries VALUES ('a', 99, 'obs', ?, 'x')").run('x'.repeat(24001)));
});

test('only agents write the log; who and feed', async (t) => {
  const { s, admin, agents: { a } } = await setup(t, ['a']);
  assert.equal((await admin.post('/bb/log', { kind: 'obs', text: 'x' })).status, 403);
  assert.equal((await admin.get('/bb/read')).status, 403);
  await a.post('/bb/log', { kind: 'obs', text: 'one' });
  await new Promise((r) => setTimeout(r, 5));
  await a.post('/bb/log', { kind: 'done', text: 'two' });
  const feed = (await admin.get('/bb/feed')).body.entries;
  assert.deepEqual(feed.map((e) => e.text), ['two', 'one']); // newest first
  assert.equal((await admin.get(`/bb/feed?before=${encodeURIComponent(feed[0].created_at)}`)).body.entries.length, 1);
  assert.equal((await a.get('/bb/feed')).status, 403);
  await a.get('/bb/read');
  const who = (await a.get('/bb/who')).body;
  assert.equal(who[0].name, 'a');
  assert.equal(who[0].last_seq, 2);
  assert.equal(who[0].online, true);
  assert.equal(who[0].cwd, '/tmp');
  // feed did not move any cursor
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM cursors').get().n, 0);
});

test('chat and voice transcripts reach agents through /bb/read', async (t) => {
  const { s, admin, agents: { a } } = await setup(t, ['a']);
  await admin.post('/chat', { text: 'please look at the login page' });
  await a.post('/chat', { text: 'agent chatter is not echoed' });
  // a voice note stays held back while its transcript is pending
  s.db.prepare("INSERT INTO voice_notes (id, path, duration_ms, status, created_at, user_id) VALUES (1,'p',1000,'pending','2026-01-01T00:00:00.000Z',1)").run();
  s.postChat(admin.user, { text: '', voice_note_id: '1' });
  const first = await read(a);
  assert.equal(first.length, 1);
  assert.deepEqual([first[0].author, first[0].kind, first[0].source, first[0].text], ['root', 'obs', 'chat', 'please look at the login page']);
  assert.deepEqual(await read(a), []);
  s.db.prepare("UPDATE voice_notes SET status='done', transcript='deploy on friday' WHERE id=1").run();
  const second = await read(a);
  assert.equal(second.length, 1);
  assert.equal(second[0].text, '[voice note] deploy on friday');
  assert.equal(second[0].source, 'chat');
  assert.deepEqual(await read(a), []);
  assert.equal((await read(a, true)).length, 2);
});

test('import keeps entries, timestamps and cursors; refuses a second import', async (t) => {
  const { s, admin } = await setup(t, []);
  const payload = { agents: [
    { name: 'dev', role: 'builds', cwd: '/d', registered: '2026-10-24T09:00:00+0530', entries: [
      { seq: 1, kind: 'obs', text: 'one', created_at: '2026-10-24T10:00:00+0530' },
      { seq: 2, kind: 'done', text: 'two\nlines', created_at: '2026-10-24T10:05:00+0530' },
      { seq: 3, kind: 'warn', text: 'three', created_at: '2026-10-24T10:10:00+0530' } ], cursors: { qa: 1 } },
    { name: 'qa', role: 'tests', cwd: '/q', entries: [
      { seq: 1, kind: 'ask', text: 'q1', created_at: '2026-10-24T10:01:00+0530' } ], cursors: { dev: 2 } },
  ] };
  assert.equal((await admin.post('/bb/import', { agents: [{ name: 'x', entries: [{ seq: 2, kind: 'obs', text: 'g', created_at: '2026-01-01T00:00:00Z' }] }] })).status, 400);
  const r = await admin.post('/bb/import', payload);
  assert.deepEqual(r.body, { agents: 2, entries: 4 });
  assert.equal((await admin.post('/bb/import', payload)).status, 409);
  const e = s.db.prepare("SELECT created_at FROM entries WHERE author='dev' AND seq=1").get();
  assert.equal(e.created_at, '2026-10-24T04:30:00.000Z');
  // imported agents have no token yet; admin issues one and the cursor still holds
  const t1 = await admin.post('/admin/agents', { name: 'dev' });
  const dev = new Client(s.base); dev.token = t1.body.token;
  assert.deepEqual((await read(dev)).map((x) => x.text), []); // qa seq 1 already read
  const t2 = await admin.post('/admin/agents', { name: 'qa' });
  const qa = new Client(s.base); qa.token = t2.body.token;
  assert.deepEqual((await read(qa)).map((x) => x.text), ['three']); // dev cursor was 2
  await qa.post('/bb/log', { kind: 'obs', text: 'new' });
  assert.equal((await qa.post('/bb/log', { kind: 'obs', text: 'new2' })).body.seq, 3);
  // export round-trips the wm-log format
  const md = (await admin.get('/bb/export')).body.logs;
  assert.match(md.dev, /^# wm-log · dev\nrole: builds\ncwd: \/d\nregistered: 2026-10-24T03:30:00.000Z\n\n### 2026-10-24T04:30:00.000Z · dev · obs\none\n\n### /);
  assert.match(md.dev, /### 2026-10-24T04:35:00.000Z · dev · done\ntwo\nlines\n/);
  assert.equal((await dev.get('/bb/export')).status, 200);
});

test('import-logs: real wm-log files and byte cursors keep entries and read position', async (t) => {
  const bbScript = path.resolve(__dirname, '../../../blackboard/bb');
  if (!fs.existsSync(bbScript)) return t.skip('blackboard/bb not found');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbfiles-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bb = (...args) => execFileSync(bbScript, args, { env: { ...process.env, BB_DIR: dir } }).toString();
  bb('register', 'dev', 'builder'); bb('register', 'qa', 'tester');
  bb('log', 'dev', 'obs', 'first'); bb('log', 'dev', 'claim', 'multi\nline\n### 2026-01-01 · qa · done\nfake header');
  bb('log', 'qa', 'ask', '@dev ready?');
  bb('read', 'qa'); // qa has now read dev's two entries
  bb('log', 'dev', 'done', 'after qa read');
  const { s, admin } = await setup(t, []);
  const parsed = parseDir(dir);
  assert.equal(parsed.agents.find((a) => a.name === 'dev').entries.length, 3);
  assert.equal((await admin.post('/bb/import', parsed)).status, 201);
  const qa = new Client(s.base); qa.token = (await admin.post('/admin/agents', { name: 'qa' })).body.token;
  const dev = new Client(s.base); dev.token = (await admin.post('/admin/agents', { name: 'dev' })).body.token;
  assert.deepEqual((await read(qa)).map((e) => e.text), ['after qa read']);
  assert.deepEqual((await read(dev)).map((e) => e.text), ['@dev ready?']); // dev never read before: sees qa's entry
  const stored = s.db.prepare("SELECT body FROM entries WHERE author='dev' AND seq=2").get().body;
  assert.match(stored, /multi\nline\n\\### 2026-01-01 · qa · done\nfake header/);
});
