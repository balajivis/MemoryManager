'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { Floor, FloorError } = require('./floor');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_MS = 120000;
// content type -> [file extension, magic-byte check]
const FORMATS = {
  'audio/webm': ['.webm', (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))],
  'audio/mp4': ['.m4a', (b) => b.length >= 8 && b.subarray(4, 8).toString('latin1') === 'ftyp'],
};

function createVoice({ db, config = {}, broadcast, sendTo, requireSession, postChat, dataDir }) {
  const floor = config.floor || new Floor();
  const transcribe = config.transcribe || require('./transcribe').transcribe;
  const audioDir = path.join(dataDir, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });

  floor.on('change', (state, reason, userId) => {
    const msg = { type: 'floor', state };
    if (reason) { msg.reason = reason; msg.userId = userId === undefined ? null : userId; }
    broadcast(msg);
  });
  floor.on('turn', (userId, expiresAt) => sendTo(userId, { type: 'floor_turn', expiresAt }));

  const router = express.Router();
  const isAdmin = (u) => u && u.role === 'admin';
  const adminOnly = (req, res, next) =>
    isAdmin(req.user) ? next() : res.status(403).json({ error: 'admin_only' });

  router.post('/floor/request', requireSession, (req, res) => {
    try {
      res.json({ state: floor.request(req.user) });
    } catch (e) {
      if (e instanceof FloorError) return res.status(403).json({ error: e.code });
      throw e;
    }
  });
  router.post('/floor/leave', requireSession, (req, res) => {
    floor.leave(req.user.id);
    res.json({ state: floor.snapshot() });
  });
  router.post('/floor/start', requireSession, (req, res) => {
    if (!floor.start(req.user.id)) return res.status(409).json({ error: 'not_pending' });
    res.json({ state: floor.snapshot() });
  });
  router.post('/floor/skip', requireSession, adminOnly, express.json(), (req, res) => {
    const userId = req.body && req.body.userId;
    if (userId !== undefined && userId !== null) floor.removeFromQueue(userId);
    else floor.skip();
    res.json({ state: floor.snapshot() });
  });
  router.post('/floor/clear', requireSession, adminOnly, (req, res) => {
    floor.clear();
    res.json({ state: floor.snapshot() });
  });

  function mustHold(req, res, next) {
    const { holder: h, pending: p } = floor.snapshot();
    // a granted speaker who has not yet called /floor/start (pending) may upload too
    if ((!h || h.userId !== req.user.id) && !(p && p.userId === req.user.id)) return res.status(403).json({ error: 'not_holder' });
    next();
  }

  router.post('/notes', requireSession, mustHold,
    (req, res, next) => {
      const raw = req.get('X-Duration-Ms');
      const ms = raw === undefined ? 0 : Number(raw);
      if (!Number.isFinite(ms) || ms < 0) return res.status(400).json({ error: 'bad_duration' });
      if (ms > MAX_MS) return res.status(413).json({ error: 'too_long' });
      req.durationMs = Math.round(ms);
      next();
    },
    express.raw({ type: Object.keys(FORMATS), limit: MAX_BYTES }),
    async (req, res, next) => {
      try {
        if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(415).json({ error: 'bad_content_type' });
        const [ext, magicOk] = FORMATS[req.get('content-type').split(';')[0].trim().toLowerCase()];
        if (!magicOk(req.body)) return res.status(415).json({ error: 'bad_audio' });
        const id = crypto.randomUUID();
        const file = path.join(audioDir, `${id}${ext}`);
        fs.writeFileSync(file, req.body);
        db.prepare('INSERT INTO voice_notes (id, path, duration_ms, status, transcript, created_at, user_id) VALUES (?,?,?,?,?,?,?)')
          .run(id, file, req.durationMs, 'pending', null, Date.now(), req.user.id);
        floor.leave(req.user.id, 'posted');
        const message = await postChat(req.user, { text: '', voice_note_id: id });
        res.status(201).json({ id, status: 'pending', message });
        runTranscription(id, file);
      } catch (e) { next(e); }
    });

  async function runTranscription(id, file) {
    let status = 'done';
    let transcript = null;
    try {
      transcript = await transcribe(file);
    } catch (e) {
      status = e && e.code === 'DISABLED' ? 'disabled' : 'failed';
    }
    try {
      db.prepare('UPDATE voice_notes SET status = ?, transcript = ? WHERE id = ?').run(status, transcript, id);
      broadcast({ type: 'voice', id, status, transcript });
    } catch (_) { /* db closed during shutdown */ }
  }

  const getNote = (id) => db.prepare('SELECT * FROM voice_notes WHERE id = ?').get(id);

  router.get('/notes/:id/audio', requireSession, (req, res) => {
    const note = getNote(req.params.id);
    if (!note) return res.status(404).json({ error: 'not_found' });
    let size;
    try { size = fs.statSync(note.path).size; } catch (_) { return res.status(404).json({ error: 'not_found' }); }
    res.set({ 'Content-Type': note.path.endsWith('.m4a') ? 'audio/mp4' : 'audio/webm', 'Accept-Ranges': 'bytes' });
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.get('Range') || '');
    if (!m || (m[1] === '' && m[2] === '')) {
      res.set('Content-Length', String(size));
      return fs.createReadStream(note.path).pipe(res);
    }
    let start, end;
    if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
    else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
    if (start >= size || start > end) {
      res.set('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }
    res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) });
    fs.createReadStream(note.path, { start, end }).pipe(res);
  });

  router.get('/notes/:id', requireSession, (req, res) => {
    const n = getNote(req.params.id);
    if (!n) return res.status(404).json({ error: 'not_found' });
    res.json({ id: n.id, duration_ms: n.duration_ms, status: n.status, transcript: n.transcript });
  });

  router.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    next(err);
  });

  // A user may have several tabs; only when the last socket closes does the grace timer start.
  const sockets = new Map();
  function onWsConnect(ws, user) {
    sockets.set(user.id, (sockets.get(user.id) || 0) + 1);
    floor.connect(user.id);
  }
  function onWsClose(user) {
    const n = (sockets.get(user.id) || 1) - 1;
    if (n > 0) return sockets.set(user.id, n);
    sockets.delete(user.id);
    floor.disconnect(user.id);
  }

  return { router, onWsConnect, onWsClose, floor };
}

module.exports = { createVoice };
