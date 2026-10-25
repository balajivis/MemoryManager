'use strict';
// In-memory floor: one holder, FIFO queue, 15 s start window, 120 s cap, 3 s disconnect grace.
const { EventEmitter } = require('node:events');

class FloorError extends Error {
  constructor(code) { super(code); this.code = code; }
}

class Floor extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.now = opts.now || Date.now;
    this.setT = opts.setTimeout || ((fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; });
    this.clearT = opts.clearTimeout || clearTimeout;
    this.capMs = opts.capMs || 120000;
    this.uploadGraceMs = opts.uploadGraceMs || 20000;
    this.startMs = opts.startMs || 15000;
    this.graceMs = opts.graceMs || 3000;
    this.holder = null;   // {userId,name,grantedAt,deadline}; the cap counts from start()
    this.queue = [];      // [{userId,name}]
    this.pending = null;  // {userId,name,expiresAt}
    this.holderTimer = null;
    this.pendingTimer = null;
    this.grace = new Map(); // userId -> timer
  }

  snapshot() {
    return {
      holder: this.holder ? { ...this.holder } : null,
      queue: this.queue.map((q, i) => ({ userId: q.userId, name: q.name, position: i + 1 })),
      pending: this.pending ? { userId: this.pending.userId, expiresAt: this.pending.expiresAt } : null,
    };
  }

  _has(userId) {
    return (this.holder && this.holder.userId === userId) ||
      (this.pending && this.pending.userId === userId) ||
      this.queue.some((q) => q.userId === userId);
  }

  // reason: posted|cancelled|cap|skipped_timeout|admin_skip|disconnect|admin_clear; userId: who lost the floor.
  _changed(reason, userId) { this.emit('change', this.snapshot(), reason, userId); }

  _clearHolder() {
    this.holder = null;
    if (this.holderTimer) this.clearT(this.holderTimer);
    this.holderTimer = null;
  }

  _clearPending() {
    this.pending = null;
    if (this.pendingTimer) this.clearT(this.pendingTimer);
    this.pendingTimer = null;
  }

  // Arm the holder's cap timer from now. At the cap the holder keeps the floor for an
  // upload grace period, so a note auto-sent at the cap is not rejected as not_holder.
  _armCap() {
    if (this.holderTimer) this.clearT(this.holderTimer);
    const t = this.now();
    this.holder.deadline = t + this.capMs;
    this.holderTimer = this.setT(() => {
      const id = this.holder.userId;
      this.holderTimer = this.setT(() => { this.holderTimer = null; this._remove(id, 'cap'); }, this.uploadGraceMs);
    }, this.capMs);
  }

  _grant(u, started) {
    this.holder = { userId: u.userId, name: u.name, grantedAt: this.now(), deadline: 0 };
    this.holderStarted = started;
    this._armCap();
  }

  // If nobody holds or is pending, offer the floor to the head of the queue.
  _advance() {
    if (this.holder || this.pending || !this.queue.length) return;
    const u = this.queue.shift();
    const expiresAt = this.now() + this.startMs;
    this.pending = { userId: u.userId, name: u.name, expiresAt };
    this.pendingTimer = this.setT(() => {
      this.pendingTimer = null;
      const p = this.pending;
      this.pending = null;
      // Skipped: back of the queue, unless nobody else is waiting.
      if (this.queue.length) this.queue.push({ userId: p.userId, name: p.name });
      this._advance();
      this._changed('skipped_timeout', p.userId);
    }, this.startMs);
    this.emit('turn', u.userId, expiresAt);
  }

  request(user) {
    if (!user || user.role === 'agent' || user.kind === 'agent' || user.is_agent) throw new FloorError('agent_forbidden');
    const u = { userId: user.id, name: user.name };
    if (this._has(u.userId)) return this.snapshot();
    this._cancelGrace(u.userId);
    if (!this.holder && !this.pending) this._grant(u, false);
    else this.queue.push(u);
    this._changed();
    return this.snapshot();
  }

  _remove(userId, reason) {
    let hit = false;
    if (this.holder && this.holder.userId === userId) { this._clearHolder(); hit = true; }
    if (this.pending && this.pending.userId === userId) { this._clearPending(); hit = true; }
    const n = this.queue.length;
    this.queue = this.queue.filter((q) => q.userId !== userId);
    if (this.queue.length !== n) hit = true;
    if (hit) { this._advance(); this._changed(reason, userId); }
    return hit;
  }

  leave(userId, reason = 'cancelled') { this._cancelGrace(userId); return this._remove(userId, reason); }
  removeFromQueue(userId) { return this._remove(userId, 'admin_skip'); }

  // The granted user confirms recording started; the 120 s cap counts from here.
  start(userId) {
    if (this.holder && this.holder.userId === userId) {
      if (this.holderStarted) return true;
      this.holderStarted = true;
      this._armCap();
      this._changed();
      return true;
    }
    if (!this.pending || this.pending.userId !== userId) return false;
    const u = { userId, name: this.pending.name };
    this._clearPending();
    this._grant(u, true);
    this._changed();
    return true;
  }

  // Admin: drop the current holder (or the pending speaker if nobody holds).
  skip() {
    const id = this.holder ? this.holder.userId : this.pending ? this.pending.userId : null;
    if (id === null) return false;
    return this._remove(id, 'admin_skip');
  }

  // Admin: empty the queue and any pending offer. The current holder keeps the floor.
  clear() {
    if (!this.queue.length && !this.pending) return false;
    this.queue = [];
    this._clearPending();
    this._advance();
    this._changed('admin_clear', null);
    return true;
  }

  _cancelGrace(userId) {
    const t = this.grace.get(userId);
    if (t) { this.clearT(t); this.grace.delete(userId); }
  }

  // Call when the user's WS is gone (all of their sockets).
  disconnect(userId) {
    if (!this._has(userId) || this.grace.has(userId)) return;
    this.grace.set(userId, this.setT(() => {
      this.grace.delete(userId);
      this._remove(userId, 'disconnect');
    }, this.graceMs));
  }

  // Call when the user's WS (re)connects.
  connect(userId) { this._cancelGrace(userId); }
}

module.exports = { Floor, FloorError };
