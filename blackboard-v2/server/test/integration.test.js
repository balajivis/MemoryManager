'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { startServer, makeUser, makeAgent } = require('./helpers');

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(996, 7)]);
const upload = (s, c) => fetch(`${s.base}/board/api/voice/notes`, {
  method: 'POST', body: WEBM,
  headers: { cookie: c.cookie, 'x-csrf-token': c.csrf, 'content-type': 'audio/webm', 'x-duration-ms': '1500' },
});

test('voice is mounted: floor over WS, non-holder upload 403, note posts to chat and reaches agents', async (t) => {
  const s = await startServer(); t.after(s.stop);
  assert.ok(s.voice, 'src/voice.js is loaded');
  const a = await makeUser(s, { email: 'a@x.test', name: 'alice', role: 'admin' });
  const b = await makeUser(s, { email: 'b@x.test', name: 'bob' });
  const agent = await makeAgent(s, a, 'dev');
  const ws = new WebSocket(s.base.replace('http', 'ws') + '/board/api/ws', { headers: { cookie: b.cookie } });
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d)));
  await new Promise((r) => ws.on('open', r));
  await new Promise((r) => setTimeout(r, 100));
  assert.ok('floor' in msgs[0]);

  assert.equal((await a.post('/voice/floor/request')).body.state.holder.name, 'alice');
  assert.equal((await b.post('/voice/floor/request')).body.state.queue[0].position, 1);
  assert.equal((await upload(s, b)).status, 403);
  assert.equal((await agent.post('/voice/floor/request')).status, 403);

  const up = await upload(s, a);
  assert.equal(up.status < 300, true, 'holder upload ok: ' + up.status);
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(msgs.some((m) => m.type === 'floor'));
  assert.ok(msgs.some((m) => m.type === 'chat' && m.message.voice_note_id));
  const read = (await agent.get('/bb/read')).body.entries;
  assert.equal(read.length, 1);
  assert.equal(read[0].author, 'human:alice');
  assert.match(read[0].text, /^\[voice note/);
  ws.terminate();
});
