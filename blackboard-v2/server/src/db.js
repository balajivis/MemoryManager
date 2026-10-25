'use strict';
const Database = require('better-sqlite3');

const MAX_ENTRY = 24000;
const KINDS = ['obs', 'claim', 'done', 'ask', 'reply', 'warn'];
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

const MIGRATIONS = [
  `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  password_hash TEXT NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE invites (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE agents (
  name TEXT PRIMARY KEY CHECK (name GLOB '[a-z0-9]*' AND name NOT GLOB '*[^a-z0-9-]*'),
  role TEXT NOT NULL DEFAULT '' CHECK (role NOT LIKE '%' || char(10) || '%' AND role NOT LIKE '%' || char(13) || '%'),
  cwd TEXT NOT NULL DEFAULT '' CHECK (cwd NOT LIKE '%' || char(10) || '%' AND cwd NOT LIKE '%' || char(13) || '%'),
  token_hash TEXT UNIQUE,
  registered_at TEXT NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  last_read_at TEXT
);
CREATE TABLE entries (
  author TEXT NOT NULL REFERENCES agents(name),
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('obs','claim','done','ask','reply','warn')),
  body TEXT NOT NULL CHECK (body <> '' AND length(CAST(body AS BLOB)) <= ${MAX_ENTRY}),
  created_at TEXT NOT NULL,
  PRIMARY KEY (author, seq)
);
CREATE TRIGGER entries_no_update BEFORE UPDATE ON entries
  BEGIN SELECT RAISE(ABORT, 'entries is append-only; post a correction instead'); END;
CREATE TRIGGER entries_no_delete BEFORE DELETE ON entries
  BEGIN SELECT RAISE(ABORT, 'entries is append-only; post a correction instead'); END;
CREATE TABLE cursors (
  reader TEXT NOT NULL REFERENCES agents(name),
  author TEXT NOT NULL,
  last_seq INTEGER NOT NULL,
  PRIMARY KEY (reader, author)
);
CREATE TABLE voice_notes (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  transcript TEXT,
  created_at TEXT NOT NULL,
  user_id INTEGER
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  author TEXT NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('human','agent')),
  user_id INTEGER,
  text TEXT NOT NULL DEFAULT '',
  voice_note_id TEXT REFERENCES voice_notes(id),
  created_at TEXT NOT NULL
);
CREATE TABLE chat_delivered (
  agent TEXT NOT NULL REFERENCES agents(name),
  message_id INTEGER NOT NULL,
  PRIMARY KEY (agent, message_id)
);
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'claimed' CHECK (stage IN ('claimed','built','tested','pr','merged','live')),
  status TEXT NOT NULL DEFAULT '',
  needed TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE board (
  key TEXT PRIMARY KEY CHECK (key IN ('directive','strategy')),
  text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
`,
  `
CREATE TABLE item_history (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  at TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  by TEXT NOT NULL
);
CREATE TABLE summaries (
  day TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  done TEXT NOT NULL DEFAULT '[]',
  blocked TEXT NOT NULL DEFAULT '[]',
  author TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
];

function now() { return new Date().toISOString(); }

function openDb(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  const v = db.pragma('user_version', { simple: true });
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
    }).immediate();
  }
  return db;
}

class BbError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

// escape body lines that look like an entry header, as bb does
function escapeBody(text) {
  return text.replace(/^([ \t]*)###/gm, '$1\\###');
}

function logEntry(db, author, kind, text, createdAt) {
  if (!KINDS.includes(kind)) throw new BbError(400, 'bad_kind', `kind must be one of ${KINDS.join('|')}`);
  if (typeof text !== 'string' || text === '') throw new BbError(400, 'empty_entry', 'empty entry');
  const body = escapeBody(text);
  const bytes = Buffer.byteLength(body);
  if (bytes > MAX_ENTRY) throw new BbError(413, 'too_large', `entry is ${bytes} bytes (max ${MAX_ENTRY})`);
  const ts = createdAt || now();
  return db.transaction(() => {
    const row = db.prepare('UPDATE agents SET last_seq = last_seq + 1 WHERE name = ? RETURNING last_seq').get(author);
    if (!row) throw new BbError(404, 'not_registered', `agent ${author} is not registered`);
    db.prepare('INSERT INTO entries (author, seq, kind, body, created_at) VALUES (?,?,?,?,?)')
      .run(author, row.last_seq, kind, body, ts);
    return { author, seq: row.last_seq, kind, text: body, created_at: ts };
  }).immediate();
}

function chatEntryText(m) {
  if (!m.voice_note_id) return m.text;
  const t = m.transcript;
  if (t) return `[voice note] ${t}`;
  return m.text ? `[voice note] ${m.text}` : '[voice note, no transcript]';
}

// Entries from others since this reader's cursors, plus human chat/voice not yet delivered.
// Cursors advance in the same transaction, so nothing is skipped or repeated.
function readEntries(db, reader, replay) {
  return db.transaction(() => {
    const me = db.prepare('UPDATE agents SET last_read_at = ? WHERE name = ? RETURNING name').get(now(), reader);
    if (!me) throw new BbError(404, 'not_registered', `agent ${reader} is not registered`);
    const rows = db.prepare(`
      SELECT e.author, e.seq, e.kind, e.body AS text, e.created_at
      FROM entries e LEFT JOIN cursors c ON c.reader = ? AND c.author = e.author
      WHERE e.author <> ? AND (? OR e.seq > COALESCE(c.last_seq, 0))`).all(reader, reader, replay ? 1 : 0);
    const up = db.prepare(`INSERT INTO cursors (reader, author, last_seq) VALUES (?,?,?)
      ON CONFLICT (reader, author) DO UPDATE SET last_seq = MAX(last_seq, excluded.last_seq)`);
    const maxes = {};
    for (const r of rows) maxes[r.author] = Math.max(maxes[r.author] || 0, r.seq);
    for (const [a, s] of Object.entries(maxes)) up.run(reader, a, s);

    // a voice note is held back until its transcript is no longer pending
    const msgs = db.prepare(`
      SELECT m.id, m.author, m.text, m.voice_note_id, m.created_at, v.transcript
      FROM messages m LEFT JOIN voice_notes v ON v.id = m.voice_note_id
      WHERE m.author_kind = 'human' AND (v.id IS NULL OR v.status <> 'pending')
        AND (? OR m.id NOT IN (SELECT message_id FROM chat_delivered WHERE agent = ?))`).all(replay ? 1 : 0, reader);
    const mark = db.prepare('INSERT OR IGNORE INTO chat_delivered (agent, message_id) VALUES (?,?)');
    const chat = msgs.map((m) => {
      mark.run(reader, m.id);
      return { author: m.author, seq: m.id, kind: 'obs', text: chatEntryText(m), created_at: m.created_at, source: 'chat' };
    });
    return rows.concat(chat).sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 :
      a.author < b.author ? -1 : a.author > b.author ? 1 : a.seq - b.seq);
  }).immediate();
}

module.exports = { openDb, logEntry, readEntries, now, BbError, KINDS, NAME_RE, MAX_ENTRY };
