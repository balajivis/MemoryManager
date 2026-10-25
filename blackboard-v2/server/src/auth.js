'use strict';
const crypto = require('node:crypto');
const express = require('express');
const argon2 = require('argon2');
const { BbError, NAME_RE, now, slug } = require('./db');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rand = (n = 32) => crypto.randomBytes(n).toString('hex');
const SESSION_MS = 14 * 24 * 3600 * 1000; // absolute lifetime
const IDLE_MS = 12 * 3600 * 1000;
const INVITE_MS = 48 * 3600 * 1000;
const MAX_PW_BYTES = 256;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ } }
  }
  return out;
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createInvite(db, config, { email, name, role }) {
  if (!email || !name) throw new BbError(400, 'bad_request', 'email and name required');
  if (!['admin', 'member'].includes(role || 'member')) throw new BbError(400, 'bad_role', 'role must be admin or member');
  email = String(email).trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ? OR name = ?').get(email, name)) {
    throw new BbError(409, 'exists', 'a user with that email or name already exists');
  }
  const token = rand(32);
  db.prepare('INSERT INTO invites (token_hash, email, name, role, expires_at, created_at) VALUES (?,?,?,?,?,?)')
    .run(sha256(token), email, String(name), role || 'member', new Date(Date.now() + INVITE_MS).toISOString(), now());
  return { url: `${config.publicUrl}/board/invite/#${token}` };
}

function createAuth({ db, config }) {
  const hooks = { closeSockets: () => {} }; // set by app: ({sessionId?, userId?})
  const ipHits = new Map();
  let dummyHash;

  function publicUser(u) { return { id: u.id, name: u.name, email: u.email, role: u.role }; }

  function sessionFromReq(req) {
    const tok = parseCookies(req.headers.cookie).bb_session;
    if (!tok) return null;
    const row = db.prepare(`SELECT s.id AS sid, s.csrf, s.expires_at, s.created_at, s.last_seen_at, u.id, u.name, u.email, u.role
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(tok));
    if (!row) return null;
    const t = now();
    const seen = row.last_seen_at || row.created_at;
    if (row.expires_at < t || seen < new Date(Date.now() - IDLE_MS).toISOString()) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(row.sid);
      return null;
    }
    if (seen < new Date(Date.now() - 60000).toISOString()) db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(t, row.sid);
    return { sid: row.sid, csrf: row.csrf, user: publicUser(row) };
  }

  function setCookie(res, token, maxAgeMs) {
    const secure = config.insecureCookies ? '' : '; Secure';
    res.append('Set-Cookie', `bb_session=${token}; HttpOnly; SameSite=Lax; Path=/board; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`);
  }

  // Rotates: any session the browser presented before login is deleted, and a fresh id is issued.
  function startSession(req, res, user) {
    const old = parseCookies(req.headers.cookie).bb_session;
    if (old) {
      const o = db.prepare('SELECT id FROM sessions WHERE token_hash = ?').get(sha256(old));
      if (o) { db.prepare('DELETE FROM sessions WHERE id = ?').run(o.id); hooks.closeSockets({ sessionId: o.id }); }
    }
    const token = rand(32);
    const csrf = rand(16);
    db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?)')
      .run(sha256(token), user.id, csrf, now(), now(), new Date(Date.now() + SESSION_MS).toISOString());
    setCookie(res, token, SESSION_MS);
    return csrf;
  }

  // Sets req.actor = {kind:'human', user, sid, csrf} or {kind:'agent', name}. 401 otherwise.
  function authenticate(req, res, next) {
    const h = req.headers.authorization;
    if (h) {
      const m = /^Bearer (.+)$/.exec(h);
      const a = m && db.prepare('SELECT name FROM agents WHERE token_hash = ?').get(sha256(m[1]));
      if (!a) return next(new BbError(401, 'unauthorized', 'login required'));
      req.actor = { kind: 'agent', name: a.name };
      return next();
    }
    const s = sessionFromReq(req);
    if (!s) return next(new BbError(401, 'unauthorized', 'login required'));
    req.actor = { kind: 'human', user: s.user, sid: s.sid, csrf: s.csrf };
    next();
  }

  // every write by a session needs X-CSRF-Token (agents are exempt)
  function csrf(req, res, next) {
    if (req.actor.kind === 'human' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const got = Buffer.from(String(req.headers['x-csrf-token'] || ''));
      const want = Buffer.from(req.actor.csrf);
      if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
        return next(new BbError(403, 'csrf', 'missing or bad CSRF token'));
      }
    }
    next();
  }

  // for routes that serve only logged-in humans; sets req.user
  function requireSession(req, res, next) {
    if (!req.actor) return authenticate(req, res, (err) => (err ? next(err) : requireSession(req, res, next)));
    if (req.actor.kind !== 'human') return next(new BbError(403, 'humans_only', 'humans only'));
    req.user = req.actor.user;
    next();
  }
  function requireAdmin(req, res, next) {
    if (req.actor.kind !== 'human' || req.actor.user.role !== 'admin') return next(new BbError(403, 'admin_only', 'admin only'));
    next();
  }
  function requireAgent(req, res, next) {
    if (req.actor.kind !== 'agent') return next(new BbError(403, 'agents_only', 'agent token required'));
    next();
  }

  function ipLimit(req, res, next) {
    const t = Date.now();
    let h = ipHits.get(req.ip);
    if (!h || h.resetAt < t) { h = { n: 0, resetAt: t + LOCK_MS }; ipHits.set(req.ip, h); }
    if (++h.n > config.loginIpMax) return next(new BbError(429, 'rate_limited', 'too many attempts, try later'));
    next();
  }

  // ---- public routes
  const pub = express.Router();
  pub.get('/healthz', (req, res) => res.json({ ok: true }));

  const pwBytesOk = (pw) => Buffer.byteLength(pw) <= MAX_PW_BYTES;
  const tooLong = () => new BbError(400, 'password_too_long', `password must be at most ${MAX_PW_BYTES} bytes`);

  // Lockout is per (lowercased email, IP) and is identical for real and unknown emails.
  pub.post('/auth/login', ipLimit, wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') throw new BbError(400, 'bad_request', 'email and password required');
    if (!pwBytesOk(password)) throw tooLong();
    const em = email.trim().toLowerCase();
    const ip = String(req.ip);
    const t = Date.now();
    const rec = db.prepare('SELECT n, first_at FROM login_fails WHERE email = ? AND ip = ?').get(em, ip);
    const live = rec && rec.first_at + LOCK_MS > t ? rec : null;
    if (live && live.n >= MAX_FAILS) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((live.first_at + LOCK_MS - t) / 1000))));
      throw new BbError(429, 'too_many_attempts', 'too many failed attempts, try again later');
    }
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(em);
    let ok = false;
    if (u) {
      ok = await argon2.verify(u.password_hash, password).catch(() => false);
    } else {
      dummyHash = dummyHash || await argon2.hash('dummy-password', { type: argon2.argon2id });
      await argon2.verify(dummyHash, password).catch(() => false);
    }
    if (!ok) {
      if (live) db.prepare('UPDATE login_fails SET n = n + 1 WHERE email = ? AND ip = ?').run(em, ip);
      else db.prepare('INSERT OR REPLACE INTO login_fails (email, ip, n, first_at) VALUES (?,?,1,?)').run(em, ip, t);
      db.prepare('DELETE FROM login_fails WHERE first_at < ?').run(t - LOCK_MS);
      throw new BbError(401, 'invalid_credentials', 'invalid email or password');
    }
    db.prepare('DELETE FROM login_fails WHERE email = ? AND ip = ?').run(em, ip);
    const token = startSession(req, res, u);
    res.json({ user: publicUser(u), csrf: token });
  }));

  function findInvite(token) {
    if (typeof token !== 'string') throw new BbError(404, 'invalid_invite', 'invite is invalid or expired');
    const inv = db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(sha256(token));
    if (!inv || inv.used_at || inv.expires_at < now()) throw new BbError(404, 'invalid_invite', 'invite is invalid or expired');
    return inv;
  }
  pub.post('/auth/invite/lookup', (req, res) => {
    const inv = findInvite((req.body || {}).token);
    res.json({ email: inv.email, name: inv.name });
  });
  pub.post('/auth/invite/accept', wrap(async (req, res) => {
    const inv = findInvite((req.body || {}).token);
    const pw = (req.body || {}).password;
    if (typeof pw !== 'string' || pw.length < 12) throw new BbError(400, 'weak_password', 'password must be at least 12 characters');
    if (!pwBytesOk(pw)) throw tooLong();
    const hash = await argon2.hash(pw, { type: argon2.argon2id });
    const user = db.transaction(() => {
      if (db.prepare('SELECT used_at FROM invites WHERE id = ?').get(inv.id).used_at) throw new BbError(404, 'invalid_invite', 'invite is invalid or expired');
      let info;
      try {
        info = db.prepare('INSERT INTO users (email, name, role, password_hash, created_at) VALUES (?,?,?,?,?)')
          .run(inv.email, inv.name, inv.role, hash, now());
      } catch (e) { throw new BbError(409, 'exists', 'a user with that email or name already exists'); }
      db.prepare('UPDATE invites SET used_at = ? WHERE id = ?').run(now(), inv.id);
      return { id: info.lastInsertRowid, name: inv.name, email: inv.email, role: inv.role };
    }).immediate();
    const csrfTok = startSession(req, res, user);
    res.status(201).json({ user: publicUser(user), csrf: csrfTok });
  }));

  // ---- authenticated routes
  const priv = express.Router();
  priv.post('/auth/logout', requireSession, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.actor.sid);
    hooks.closeSockets({ sessionId: req.actor.sid });
    setCookie(res, '', 0);
    res.json({ ok: true });
  });
  priv.post('/auth/logout-all', requireSession, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
    hooks.closeSockets({ userId: req.user.id });
    setCookie(res, '', 0);
    res.json({ ok: true });
  });
  // Changes the password and ends every other session of this user (their sockets close too).
  priv.post('/auth/password', requireSession, wrap(async (req, res) => {
    const { current, password } = req.body || {};
    if (typeof current !== 'string' || typeof password !== 'string') throw new BbError(400, 'bad_request', 'current and password required');
    if (!pwBytesOk(current) || !pwBytesOk(password)) throw tooLong();
    if (password.length < 12) throw new BbError(400, 'weak_password', 'password must be at least 12 characters');
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!(await argon2.verify(u.password_hash, current).catch(() => false))) throw new BbError(401, 'invalid_credentials', 'current password is wrong');
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, u.id);
    const others = db.prepare('SELECT id FROM sessions WHERE user_id = ? AND id <> ?').all(u.id, req.actor.sid);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(u.id, req.actor.sid);
    for (const o of others) hooks.closeSockets({ sessionId: o.id });
    res.json({ ok: true });
  }));
  priv.get('/auth/me', requireSession, (req, res) => res.json({ user: req.user, csrf: req.actor.csrf }));

  const admin = express.Router();
  admin.use('/admin', requireAdmin);
  admin.post('/admin/invites', (req, res) => {
    const { email, name, role } = req.body || {};
    res.status(201).json(createInvite(db, config, { email, name, role }));
  });
  admin.get('/admin/users', (req, res) => {
    res.json({ users: db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY id').all() });
  });
  admin.delete('/admin/users/:id', (req, res) => {
    const id = Number(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) throw new BbError(404, 'not_found', 'no such user');
    if (id === req.actor.user.id) throw new BbError(400, 'self_delete', 'you cannot remove yourself');
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    hooks.closeSockets({ userId: id });
    res.json({ ok: true });
  });

  const newToken = () => 'bbt_' + rand(32);
  admin.post('/admin/agents', (req, res) => {
    const { name, role } = req.body || {};
    if (typeof name !== 'string' || !NAME_RE.test(name)) throw new BbError(400, 'bad_name', 'name must be lowercase letters, digits, dashes');
    if (db.prepare('SELECT name FROM users').all().some((u) => u.name.toLowerCase() === name || slug(u.name) === name)) {
      throw new BbError(409, 'name_taken_by_user', 'an agent cannot share a name with a human user');
    }
    const cur = db.prepare('SELECT token_hash FROM agents WHERE name = ?').get(name);
    if (cur && cur.token_hash) throw new BbError(409, 'exists', 'agent already has a token; use rotate');
    const token = newToken();
    if (cur) {
      db.prepare('UPDATE agents SET token_hash = ?, role = COALESCE(NULLIF(?, \'\'), role) WHERE name = ?').run(sha256(token), role || '', name);
    } else {
      db.prepare('INSERT INTO agents (name, role, token_hash, registered_at) VALUES (?,?,?,?)')
        .run(name, String(role || '').replace(/[\r\n]/g, ' '), sha256(token), now());
    }
    res.status(201).json({ name, token });
  });
  admin.get('/admin/agents', (req, res) => {
    res.json({ agents: db.prepare(`SELECT name, role, cwd, token_hash IS NOT NULL AS has_token, registered_at, last_seq, last_read_at
      FROM agents ORDER BY registered_at, name`).all().map((a) => ({ ...a, has_token: !!a.has_token })) });
  });
  admin.post('/admin/agents/:name/rotate', (req, res) => {
    const token = newToken();
    const r = db.prepare('UPDATE agents SET token_hash = ? WHERE name = ?').run(sha256(token), req.params.name);
    if (!r.changes) throw new BbError(404, 'not_found', 'no such agent');
    res.json({ name: req.params.name, token });
  });
  admin.delete('/admin/agents/:name', (req, res) => {
    const a = db.prepare('SELECT last_seq FROM agents WHERE name = ?').get(req.params.name);
    if (!a) throw new BbError(404, 'not_found', 'no such agent');
    // entries are append-only and reference the agent, so an agent with history keeps its row but loses its token
    if (a.last_seq === 0) {
      db.prepare('DELETE FROM chat_delivered WHERE agent = ?').run(req.params.name);
      db.prepare('DELETE FROM cursors WHERE reader = ?').run(req.params.name);
      db.prepare('DELETE FROM agents WHERE name = ?').run(req.params.name);
    } else {
      db.prepare('UPDATE agents SET token_hash = NULL WHERE name = ?').run(req.params.name);
    }
    res.json({ ok: true });
  });

  return { pub, priv, admin, authenticate, csrf, requireSession, requireAdmin, requireAgent, sessionFromReq, hooks, parseCookies };
}

module.exports = { createAuth, createInvite, sha256, parseCookies, wrap };
