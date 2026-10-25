'use strict';
const crypto = require('node:crypto');
const express = require('express');
const argon2 = require('argon2');
const { BbError, NAME_RE, now } = require('./db');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rand = (n = 32) => crypto.randomBytes(n).toString('hex');
const SESSION_MS = 30 * 24 * 3600 * 1000;
const INVITE_MS = 7 * 24 * 3600 * 1000;
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
  return { url: `${config.publicUrl}/board/invite?token=${token}` };
}

function createAuth({ db, config }) {
  const hooks = { closeSockets: () => {} }; // set by app: ({sessionId?, userId?})
  const ipHits = new Map();
  let dummyHash;

  function publicUser(u) { return { id: u.id, name: u.name, email: u.email, role: u.role }; }

  function sessionFromReq(req) {
    const tok = parseCookies(req.headers.cookie).bb_session;
    if (!tok) return null;
    const row = db.prepare(`SELECT s.id AS sid, s.csrf, s.expires_at, u.id, u.name, u.email, u.role
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(tok));
    if (!row || row.expires_at < now()) return null;
    return { sid: row.sid, csrf: row.csrf, user: publicUser(row) };
  }

  function setCookie(res, token, maxAgeMs) {
    const secure = config.insecureCookies ? '' : '; Secure';
    res.append('Set-Cookie', `bb_session=${token}; HttpOnly; SameSite=Lax; Path=/board; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`);
  }

  function startSession(res, user) {
    const token = rand(32);
    const csrf = rand(16);
    db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, created_at, expires_at) VALUES (?,?,?,?,?)')
      .run(sha256(token), user.id, csrf, now(), new Date(Date.now() + SESSION_MS).toISOString());
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

  pub.post('/auth/login', ipLimit, wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') throw new BbError(400, 'bad_request', 'email and password required');
    const bad = () => new BbError(401, 'invalid_credentials', 'invalid email or password');
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
    if (!u) {
      dummyHash = dummyHash || await argon2.hash('dummy-password', { type: argon2.argon2id });
      await argon2.verify(dummyHash, password).catch(() => false);
      throw bad();
    }
    if (u.locked_until && u.locked_until > now()) throw new BbError(423, 'locked', 'account locked, try again later');
    const ok = await argon2.verify(u.password_hash, password).catch(() => false);
    if (!ok) {
      const fails = u.failed_count + 1;
      if (fails >= MAX_FAILS) {
        db.prepare('UPDATE users SET failed_count = 0, locked_until = ? WHERE id = ?')
          .run(new Date(Date.now() + LOCK_MS).toISOString(), u.id);
      } else {
        db.prepare('UPDATE users SET failed_count = ? WHERE id = ?').run(fails, u.id);
      }
      throw bad();
    }
    db.prepare('UPDATE users SET failed_count = 0, locked_until = NULL WHERE id = ?').run(u.id);
    const token = startSession(res, u);
    res.json({ user: publicUser(u), csrf: token });
  }));

  function findInvite(token) {
    const inv = db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(sha256(String(token)));
    if (!inv || inv.used_at || inv.expires_at < now()) throw new BbError(404, 'invalid_invite', 'invite is invalid or expired');
    return inv;
  }
  pub.get('/auth/invite/:token', (req, res) => {
    const inv = findInvite(req.params.token);
    res.json({ email: inv.email, name: inv.name });
  });
  pub.post('/auth/invite/:token', wrap(async (req, res) => {
    const inv = findInvite(req.params.token);
    const pw = (req.body || {}).password;
    if (typeof pw !== 'string' || pw.length < 12) throw new BbError(400, 'weak_password', 'password must be at least 12 characters');
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
    const csrfTok = startSession(res, user);
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
