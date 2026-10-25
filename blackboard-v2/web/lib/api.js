// Small fetch wrapper. Relative /board/api, same-origin cookies, CSRF on writes.
export const BASE = '/board/api';

let csrf = null;
export function setCsrf(t) { csrf = t; }

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.message) || (body && body.error) || 'HTTP ' + status);
    this.status = status;
    this.code = body && body.error;
  }
}

// api('POST', '/chat', {text})  |  api('GET', '/chat?limit=50')
// opts: { raw: Blob, headers: {}, noRedirect: true }
export async function api(method, path, body, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const init = { method, credentials: 'same-origin', headers };
  if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
  if (opts.raw) {
    init.body = opts.raw;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  if (res.status === 401 && !opts.noRedirect) {
    if (typeof window !== 'undefined') window.location.assign('/board/login/');
    throw new ApiError(401, { error: 'unauthorized' });
  }
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const audioUrl = (id) => BASE + '/voice/notes/' + id + '/audio';

export async function loadMe(opts) {
  const me = await api('GET', '/auth/me', undefined, opts);
  setCsrf(me.csrf);
  return me.user;
}
