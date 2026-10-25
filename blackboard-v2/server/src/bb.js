'use strict';
const express = require('express');
const { BbError, NAME_RE, KINDS, logEntry, readEntries, now } = require('./db');

function normTs(s) {
  if (typeof s !== 'string') throw new BbError(400, 'bad_timestamp', 'timestamp must be a string');
  const t = new Date(s.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
  if (isNaN(t)) throw new BbError(400, 'bad_timestamp', `bad timestamp: ${s}`);
  return t.toISOString();
}

// One-time import. Keeps seq, kind, body and timestamps; cursors are {author: seq}.
function importData(db, data) {
  if (!data || !Array.isArray(data.agents)) throw new BbError(400, 'bad_request', 'agents array required');
  return db.transaction(() => {
    if (db.prepare('SELECT 1 FROM entries LIMIT 1').get()) throw new BbError(409, 'not_empty', 'entries exist; import refused');
    let n = 0;
    const insAgent = db.prepare(`INSERT INTO agents (name, role, cwd, registered_at, last_seq) VALUES (?,?,?,?,?)
      ON CONFLICT (name) DO UPDATE SET role = excluded.role, cwd = excluded.cwd, last_seq = excluded.last_seq`);
    const insEntry = db.prepare('INSERT INTO entries (author, seq, kind, body, created_at) VALUES (?,?,?,?,?)');
    for (const a of data.agents) {
      if (typeof a.name !== 'string' || !NAME_RE.test(a.name)) throw new BbError(400, 'bad_name', `bad agent name: ${a.name}`);
      const entries = (a.entries || []).slice().sort((x, y) => x.seq - y.seq);
      entries.forEach((e, i) => {
        if (e.seq !== i + 1) throw new BbError(400, 'bad_seq', `${a.name}: seq must be gapless from 1`);
        if (!KINDS.includes(e.kind)) throw new BbError(400, 'bad_kind', `${a.name} #${e.seq}: bad kind`);
      });
      insAgent.run(a.name, String(a.role || '').replace(/[\r\n]/g, ' '), String(a.cwd || '').replace(/[\r\n]/g, ' '),
        a.registered ? normTs(a.registered) : now(), entries.length);
      for (const e of entries) { insEntry.run(a.name, e.seq, e.kind, e.text, normTs(e.created_at)); n++; }
    }
    const insCur = db.prepare('INSERT OR REPLACE INTO cursors (reader, author, last_seq) VALUES (?,?,?)');
    for (const a of data.agents) {
      for (const [author, seq] of Object.entries(a.cursors || {})) {
        if (!Number.isInteger(seq) || seq < 0) throw new BbError(400, 'bad_cursor', `bad cursor ${a.name}/${author}`);
        insCur.run(a.name, author, seq);
      }
    }
    return { agents: data.agents.length, entries: n };
  }).immediate();
}

function exportMarkdown(db) {
  const out = {};
  for (const a of db.prepare('SELECT * FROM agents ORDER BY registered_at, name').all()) {
    let md = `# wm-log · ${a.name}\nrole: ${a.role}\ncwd: ${a.cwd}\nregistered: ${a.registered_at}\n`;
    for (const e of db.prepare('SELECT * FROM entries WHERE author = ? ORDER BY seq').all(a.name)) {
      md += `\n### ${e.created_at} · ${a.name} · ${e.kind}\n${e.body}\n`;
    }
    out[a.name] = md;
  }
  return out;
}

function createBbRouter({ db, auth, broadcast, config }) {
  const r = express.Router();
  const { requireAgent, requireSession, requireAdmin } = auth;

  r.post('/bb/register', requireAgent, (req, res) => {
    const { name, role, cwd } = req.body || {};
    if (name !== req.actor.name) throw new BbError(403, 'name_mismatch', 'name must equal the token\'s agent');
    const clean = (s) => String(s || '').replace(/[\r\n]/g, ' ');
    db.prepare(`UPDATE agents SET role = COALESCE(NULLIF(?, ''), role), cwd = COALESCE(NULLIF(?, ''), cwd) WHERE name = ?`)
      .run(clean(role), clean(cwd), name);
    const a = db.prepare('SELECT name, role, cwd, registered_at FROM agents WHERE name = ?').get(name);
    res.json(a);
  });

  r.post('/bb/log', requireAgent, (req, res) => {
    const { kind, text } = req.body || {};
    const e = logEntry(db, req.actor.name, kind, text);
    broadcast({ type: 'feed', entry: e });
    res.status(201).json({ author: e.author, seq: e.seq, created_at: e.created_at });
  });

  r.get('/bb/read', requireAgent, (req, res) => {
    res.json({ entries: readEntries(db, req.actor.name, req.query.replay === '1') });
  });

  r.get('/bb/who', (req, res) => {
    const cutoff = new Date(Date.now() - config.agentOnlineMs).toISOString();
    const rows = db.prepare('SELECT name, role, cwd, last_seq, last_read_at FROM agents ORDER BY registered_at, name').all();
    res.json(rows.map((a) => ({ ...a, online: !!a.last_read_at && a.last_read_at >= cutoff })));
  });

  r.get('/bb/feed', requireSession, (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const before = req.query.before ? normTs(String(req.query.before)) : '9999';
    const entries = db.prepare(`SELECT author, seq, kind, body AS text, created_at FROM entries
      WHERE created_at < ? ORDER BY created_at DESC, author DESC, seq DESC LIMIT ?`).all(before, limit);
    res.json({ entries });
  });

  r.get('/bb/export', (req, res) => {
    if (req.actor.kind === 'human' && req.actor.user.role !== 'admin') throw new BbError(403, 'admin_only', 'admin only');
    res.json({ logs: exportMarkdown(db) });
  });

  r.post('/bb/import', requireAdmin, (req, res) => {
    res.status(201).json(importData(db, req.body));
  });

  return r;
}

module.exports = { createBbRouter, importData, exportMarkdown, normTs };
