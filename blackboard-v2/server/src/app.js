'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { openDb, BbError } = require('./db');
const { createAuth } = require('./auth');
const { createBbRouter } = require('./bb');
const { createBoardRouter } = require('./board');

function loadConfig(env = process.env) {
  const dataDir = env.DATA_DIR || path.join(process.cwd(), 'data');
  return {
    port: Number(env.PORT || 8790),
    dataDir,
    dbPath: env.DB_PATH || path.join(dataDir, 'board.db'),
    insecureCookies: env.INSECURE_COOKIES === '1',
    publicUrl: (env.PUBLIC_URL || 'https://memorymanager.getkapi.com').replace(/\/$/, ''),
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    loginIpMax: Number(env.LOGIN_IP_MAX || 30),
    agentOnlineMs: 10 * 60 * 1000,
  };
}

function tryRequireVoice() {
  try { return require('./voice'); } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND' && /Cannot find module '\.\/voice'/.test(e.message)) return null;
    throw e;
  }
}

function createApp(overrides = {}) {
  const config = { ...loadConfig({}), ...overrides };
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = openDb(config.dbPath);
  const auth = createAuth({ db, config });

  // ---- websocket registry
  const sockets = new Set(); // {ws, user, sid}
  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const broadcast = (msg) => { for (const s of sockets) send(s.ws, msg); };
  const sendTo = (userId, msg) => { for (const s of sockets) if (s.user.id === userId) send(s.ws, msg); };
  const onlineNames = () => [...new Set([...sockets].map((s) => s.user.name))];
  auth.hooks.closeSockets = ({ sessionId, userId }) => {
    for (const s of sockets) if (s.sid === sessionId || s.user.id === userId) s.ws.close(4401, 'logged out');
  };

  const board = createBoardRouter({ db, auth, broadcast, onlineHumans: onlineNames, config });

  const voiceMod = tryRequireVoice();
  const voice = voiceMod && voiceMod.createVoice({
    db, config, broadcast, sendTo, requireSession: auth.requireSession,
    postChat: (user, msg) => board.postChat(user, msg), dataDir: config.dataDir,
  });

  // ---- http
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  const api = express.Router();
  app.use('/board/api', api);

  api.use((req, res, next) => {
    res.set({
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
    if (!config.insecureCookies) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  const originOk = (origin, host) => {
    if (config.allowedOrigins.length) return config.allowedOrigins.includes(origin);
    try { return new URL(origin).host === host; } catch { return false; }
  };
  api.use((req, res, next) => {
    const o = req.headers.origin;
    if (o && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !originOk(o, req.headers.host)) {
      return next(new BbError(403, 'bad_origin', 'origin not allowed'));
    }
    next();
  });

  const bigJson = express.json({ limit: '50mb' });
  const smallJson = express.json({ limit: '1mb' });
  api.use((req, res, next) => (req.path === '/bb/import' ? bigJson : smallJson)(req, res, next));

  api.use(auth.pub);
  api.use(auth.authenticate, auth.csrf);
  api.use(auth.priv, auth.admin);
  api.use(createBbRouter({ db, auth, broadcast, config }));
  api.use(board.router);
  if (voice) api.use('/voice', voice.router);
  api.use((req, res, next) => next(new BbError(404, 'not_found', 'no such route')));
  api.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof BbError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.type || 'bad_request', message: err.message });
    if (err.code && String(err.code).startsWith('SQLITE_CONSTRAINT')) return res.status(400).json({ error: 'constraint', message: err.message });
    console.error(err);
    res.status(500).json({ error: 'internal', message: 'internal error' });
  });

  // ---- websocket
  const wss = new WebSocketServer({ noServer: true });
  function onUpgrade(req, socket, head) {
    const reject = (code, text) => { socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
    if (new URL(req.url, 'http://x').pathname !== '/board/api/ws') return reject(404, 'Not Found');
    if (req.headers.origin && !originOk(req.headers.origin, req.headers.host)) return reject(403, 'Forbidden');
    const s = auth.sessionFromReq(req);
    if (!s) return reject(401, 'Unauthorized');
    wss.handleUpgrade(req, socket, head, (ws) => {
      const entry = { ws, user: s.user, sid: s.sid };
      sockets.add(entry);
      send(ws, { type: 'hello', user: s.user, floor: voice ? voice.floor.snapshot() : null, online: onlineNames() });
      if (voice) voice.onWsConnect(ws, s.user);
      broadcast({ type: 'presence', online: onlineNames() });
      ws.on('message', (data) => {
        try { if (JSON.parse(data).type === 'ping') send(ws, { type: 'pong' }); } catch { /* ignore */ }
      });
      ws.on('close', () => {
        sockets.delete(entry);
        if (voice) voice.onWsClose(s.user);
        broadcast({ type: 'presence', online: onlineNames() });
      });
    });
  }

  function listen(port = config.port, host = '127.0.0.1') {
    const server = http.createServer(app);
    server.on('upgrade', onUpgrade);
    return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
  }

  async function close(server) {
    for (const s of sockets) s.ws.terminate();
    if (server) await new Promise((r) => { server.close(r); server.closeAllConnections(); });
    db.close();
  }

  return { app, db, config, listen, close, broadcast, sendTo, voice, postChat: board.postChat };
}

module.exports = { createApp, loadConfig };
