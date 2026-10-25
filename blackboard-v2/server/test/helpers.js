'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { createInvite } = require('../src/auth');

async function startServer(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbv2-'));
  const ctx = createApp({ dataDir: dir, dbPath: path.join(dir, 'board.db'), insecureCookies: true,
    publicUrl: 'http://x.test', ...extra });
  const server = await ctx.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    ...ctx, base, dir,
    stop: async () => { await ctx.close(server); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

// minimal client with a cookie jar and CSRF handling
class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.csrf = ''; this.token = ''; }
  async req(method, p, body, headers = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (this.token) h.authorization = `Bearer ${this.token}`;
    if (this.csrf && !h['x-csrf-token'] && h['x-csrf-token'] !== null) h['x-csrf-token'] = this.csrf;
    if (h['x-csrf-token'] === null) delete h['x-csrf-token'];
    if (body !== undefined) h['content-type'] = 'application/json';
    const r = await fetch(`${this.base}/board/api${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.getSetCookie();
    if (set.length) {
      const m = /^bb_session=([^;]*)/.exec(set[set.length - 1]);
      this.cookie = m && m[1] ? `bb_session=${m[1]}` : '';
    }
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    if (json && json.csrf && p.startsWith('/auth/') && r.ok) this.csrf = json.csrf;
    return { status: r.status, body: json, headers: r.headers };
  }
  get(p, h) { return this.req('GET', p, undefined, h); }
  post(p, b, h) { return this.req('POST', p, b === undefined ? {} : b, h); }
  put(p, b, h) { return this.req('PUT', p, b, h); }
  patch(p, b, h) { return this.req('PATCH', p, b, h); }
  del(p, h) { return this.req('DELETE', p, undefined, h); }
}

// create a user directly through the invite flow and return a logged-in client
async function makeUser(s, { email, name, role = 'member', password = 'correct horse battery' }) {
  const { url } = createInvite(s.db, s.config, { email, name, role });
  const token = new URL(url).hash.slice(1);
  const c = new Client(s.base);
  const r = await c.post('/auth/invite/accept', { token, password });
  if (r.status !== 201) throw new Error('invite failed ' + JSON.stringify(r.body));
  return Object.assign(c, { password, email, user: r.body.user });
}

async function makeAgent(s, admin, name, role = 'tester') {
  const r = await admin.post('/admin/agents', { name, role });
  if (r.status !== 201) throw new Error('agent failed ' + JSON.stringify(r.body));
  const c = new Client(s.base);
  c.token = r.body.token;
  await c.post('/bb/register', { name, role, cwd: '/tmp' });
  return c;
}

module.exports = { startServer, Client, makeUser, makeAgent };
