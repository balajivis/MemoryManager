'use strict';
const express = require('express');
const { BbError, now } = require('./db');

const STAGES = ['claimed', 'built', 'tested', 'pr', 'merged', 'live'];
const MAX_CHAT = 4000;
const TILES = [
  { key: 'blocked', title: 'Needs a human', match: (i) => !!i.needed && i.stage !== 'live' },
  { key: 'in_progress', title: 'In progress', match: (i) => ['claimed', 'built', 'tested', 'pr'].includes(i.stage) },
  { key: 'delivered', title: 'Features delivered', match: (i) => i.stage === 'merged' || i.stage === 'live' },
  { key: 'live', title: 'Live', match: (i) => i.stage === 'live' },
  { key: 'all', title: 'All items', match: () => true },
];

function createBoardRouter({ db, auth, broadcast, onlineHumans, config }) {
  const r = express.Router();
  const { requireSession } = auth;

  function snapshot() {
    const text = (k) => (db.prepare('SELECT text FROM board WHERE key = ?').get(k) || { text: '' }).text;
    const items = db.prepare('SELECT * FROM items ORDER BY id').all();
    const online = new Set(onlineHumans());
    const cutoff = new Date(Date.now() - config.agentOnlineMs).toISOString();
    const roster = db.prepare('SELECT name, role FROM users ORDER BY id').all()
      .map((u) => ({ name: u.name, kind: 'human', role: u.role, online: online.has(u.name) }))
      .concat(db.prepare('SELECT name, role, last_read_at FROM agents ORDER BY registered_at, name').all()
        .map((a) => ({ name: a.name, kind: 'agent', role: a.role, online: !!a.last_read_at && a.last_read_at >= cutoff })));
    const by_stage = Object.fromEntries(STAGES.map((s) => [s, items.filter((i) => i.stage === s).length]));
    const cards = TILES.map((t) => ({ key: t.key, title: t.title, count: items.filter(t.match).length }));
    const tiles = {
      cards, by_stage, online: roster.filter((p) => p.online).length,
      ...Object.fromEntries(cards.map((c) => [c.key, c.count])),
    };
    return { directive: text('directive'), strategy: text('strategy'), items, tiles, roster };
  }
  const pushBoard = () => broadcast({ type: 'board', board: snapshot() });

  r.get('/board', (req, res) => res.json(snapshot()));

  for (const key of ['directive', 'strategy']) {
    r.put(`/board/${key}`, requireSession, (req, res) => {
      const text = (req.body || {}).text;
      if (typeof text !== 'string' || text.length > 20000) throw new BbError(400, 'bad_request', 'text required (max 20000 chars)');
      db.prepare(`INSERT INTO board (key, text, updated_at, updated_by) VALUES (?,?,?,?)
        ON CONFLICT (key) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
        .run(key, text, now(), req.user.name);
      pushBoard();
      res.json({ text });
    });
  }

  const actorName = (req) => (req.actor.kind === 'agent' ? req.actor.name : req.actor.user.name);
  const addHistory = (item, by) => db.prepare('INSERT INTO item_history (item_id, at, stage, status, by) VALUES (?,?,?,?,?)')
    .run(item.id, now(), item.stage, item.status, by);
  // an entry is linked to an item when it names the item's title or "#<id>"
  function linkedEntries(items) {
    if (!items.length) return [];
    const rows = db.prepare(`SELECT author, seq, kind, body AS text, created_at FROM entries
      ORDER BY created_at DESC, author DESC, seq DESC LIMIT 1000`).all();
    const pats = items.map((i) => ({ id: new RegExp(`#${i.id}(?!\\d)`), title: i.title.toLowerCase() }));
    return rows.filter((e) => { const low = e.text.toLowerCase(); return pats.some((p) => p.id.test(e.text) || low.includes(p.title)); }).slice(0, 50);
  }
  const itemById = (id) => db.prepare('SELECT * FROM items WHERE id = ?').get(id);

  r.get('/board/tiles/:tile', (req, res) => {
    const t = TILES.find((x) => x.key === req.params.tile);
    if (!t) throw new BbError(404, 'not_found', 'no such tile');
    const items = db.prepare('SELECT * FROM items ORDER BY id').all().filter(t.match);
    res.json({ tile: t.key, title: t.title, items, entries: linkedEntries(items) });
  });
  r.get('/items/:id', (req, res) => {
    const item = itemById(Number(req.params.id));
    if (!item) throw new BbError(404, 'not_found', 'no such item');
    const history = db.prepare('SELECT at, stage, status, by FROM item_history WHERE item_id = ? ORDER BY id').all(item.id);
    res.json({ ...item, history, entries: linkedEntries([item]) });
  });

  const str = (v, d) => (v === undefined ? d : String(v).slice(0, 2000));
  r.get('/items', (req, res) => res.json({ items: db.prepare('SELECT * FROM items ORDER BY id').all() }));
  r.post('/items', (req, res) => {
    const b = req.body || {};
    if (typeof b.title !== 'string' || !b.title.trim()) throw new BbError(400, 'bad_request', 'title required');
    if (b.stage !== undefined && !STAGES.includes(b.stage)) throw new BbError(400, 'bad_stage', `stage must be one of ${STAGES.join(',')}`);
    const t = now();
    const info = db.prepare('INSERT INTO items (title, stage, status, needed, owner, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(b.title.trim().slice(0, 500), b.stage || 'claimed', str(b.status, ''), str(b.needed, ''), str(b.owner, ''), t, t);
    const item = itemById(info.lastInsertRowid);
    addHistory(item, actorName(req));
    pushBoard();
    res.status(201).json(item);
  });
  r.patch('/items/:id', (req, res) => {
    const b = req.body || {};
    const cur = db.prepare('SELECT * FROM items WHERE id = ?').get(Number(req.params.id));
    if (!cur) throw new BbError(404, 'not_found', 'no such item');
    if (b.stage !== undefined && !STAGES.includes(b.stage)) throw new BbError(400, 'bad_stage', `stage must be one of ${STAGES.join(',')}`);
    if (b.title !== undefined && (typeof b.title !== 'string' || !b.title.trim())) throw new BbError(400, 'bad_request', 'bad title');
    db.prepare('UPDATE items SET title=?, stage=?, status=?, needed=?, owner=?, updated_at=? WHERE id=?')
      .run(b.title === undefined ? cur.title : b.title.trim().slice(0, 500), b.stage || cur.stage,
        str(b.status, cur.status), str(b.needed, cur.needed), str(b.owner, cur.owner), now(), cur.id);
    const item = itemById(cur.id);
    addHistory(item, actorName(req));
    pushBoard();
    res.json(item);
  });

  // ---- chat
  function postChat(author, { text, voice_note_id }) {
    text = text || '';
    if (text.length > MAX_CHAT) throw new BbError(400, 'too_long', `message over ${MAX_CHAT} chars`);
    if (!text.trim() && !voice_note_id) throw new BbError(400, 'empty', 'empty message');
    const kind = author.kind === 'agent' ? 'agent' : 'human';
    const info = db.prepare(`INSERT INTO messages (author, author_kind, user_id, text, voice_note_id, created_at)
      VALUES (?,?,?,?,?,?)`).run(author.name, kind, kind === 'human' ? author.id : null, text, voice_note_id || null, now());
    const message = db.prepare(`SELECT id, author, author_kind, text, voice_note_id, created_at FROM messages WHERE id = ?`)
      .get(info.lastInsertRowid);
    broadcast({ type: 'chat', message });
    return message;
  }

  r.get('/chat', (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const before = parseInt(req.query.before, 10) || Number.MAX_SAFE_INTEGER;
    res.json({ messages: db.prepare(`SELECT id, author, author_kind, text, voice_note_id, created_at FROM messages
      WHERE id < ? ORDER BY id DESC LIMIT ?`).all(before, limit) });
  });
  r.post('/chat', (req, res) => {
    const text = (req.body || {}).text;
    if (typeof text !== 'string') throw new BbError(400, 'bad_request', 'text required');
    const author = req.actor.kind === 'agent' ? { name: req.actor.name, kind: 'agent' } : req.actor.user;
    res.status(201).json({ message: postChat(author, { text }) });
  });

  // ---- daily summaries
  const sumRow = (x) => x && ({ ...x, done: JSON.parse(x.done), blocked: JSON.parse(x.blocked) });
  const list = (v, keys) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > 100) throw new BbError(400, 'bad_request', 'done/blocked must be arrays');
    return v.map((o) => Object.fromEntries(keys.map((k) => [k, String((o || {})[k] || '').slice(0, 500)])));
  };
  r.post('/summaries', auth.requireAgent, (req, res) => {
    const { day, text, done, blocked } = req.body || {};
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || isNaN(new Date(day))) throw new BbError(400, 'bad_day', 'day must be YYYY-MM-DD');
    if (typeof text !== 'string' || !text.trim()) throw new BbError(400, 'bad_request', 'text required');
    if (Buffer.byteLength(text) > 8192) throw new BbError(413, 'too_large', 'text max 8 KB');
    const t = now();
    db.prepare(`INSERT INTO summaries (day, text, done, blocked, author, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT (day) DO UPDATE SET text = excluded.text, done = excluded.done, blocked = excluded.blocked,
        author = excluded.author, updated_at = excluded.updated_at`)
      .run(day, text, JSON.stringify(list(done, ['title', 'owner'])), JSON.stringify(list(blocked, ['title', 'needed'])), req.actor.name, t, t);
    const summary = sumRow(db.prepare('SELECT * FROM summaries WHERE day = ?').get(day));
    broadcast({ type: 'summary', summary });
    res.status(201).json({ summary });
  });
  r.get('/summaries', (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 14, 1), 100);
    res.json({ summaries: db.prepare('SELECT * FROM summaries ORDER BY day DESC LIMIT ?').all(limit).map(sumRow) });
  });
  r.get('/summaries/:day', (req, res) => {
    const x = sumRow(db.prepare('SELECT * FROM summaries WHERE day = ?').get(req.params.day));
    if (!x) throw new BbError(404, 'not_found', 'no summary for that day');
    res.json({ summary: x });
  });

  return { router: r, postChat, snapshot };
}

module.exports = { createBoardRouter };
