'use strict';
// Parses blackboard/agents/*/wm-log.md and .cursors (byte offsets) into the /bb/import payload.
const fs = require('node:fs');
const path = require('node:path');
const { normTs } = require('./bb');

const HEADER = /^### (\S+) · ([a-z0-9-]+) · (obs|claim|done|ask|reply|warn)$/gm;

function parseLog(file) {
  const buf = fs.readFileSync(file);
  const text = buf.toString('utf8');
  const meta = (k) => (new RegExp(`^${k}: (.*)$`, 'm').exec(text.split(/^### /m)[0]) || [])[1] || '';
  const heads = [...text.matchAll(HEADER)];
  const entries = [];
  const ends = [];
  heads.forEach((h, i) => {
    const bodyStart = h.index + h[0].length + 1;
    const nextStart = i + 1 < heads.length ? heads[i + 1].index : text.length;
    const raw = text.slice(bodyStart, nextStart).replace(/\n+$/, '');
    entries.push({ seq: i + 1, kind: h[3], text: raw, created_at: normTs(h[1]) });
    // the blank line before the next header is written with that next entry
    ends.push(Buffer.byteLength(text.slice(0, i + 1 < heads.length ? nextStart - 1 : text.length)));
  });
  return { role: meta('role'), cwd: meta('cwd'), registered: meta('registered'), entries, ends };
}

function parseDir(bbDir) {
  const agentsDir = path.join(bbDir, 'agents');
  const parsed = {};
  for (const name of fs.readdirSync(agentsDir)) {
    const f = path.join(agentsDir, name, 'wm-log.md');
    if (fs.existsSync(f)) parsed[name] = parseLog(f);
  }
  const agents = Object.entries(parsed).map(([name, p]) => {
    const cursors = {};
    const cf = path.join(agentsDir, name, '.cursors');
    if (fs.existsSync(cf)) {
      for (const line of fs.readFileSync(cf, 'utf8').split('\n')) {
        const [author, off] = line.trim().split(/\s+/);
        if (!parsed[author] || !/^\d+$/.test(off || '')) continue;
        cursors[author] = parsed[author].ends.filter((e) => e <= Number(off)).length;
      }
    }
    return { name, role: p.role, cwd: p.cwd, registered: p.registered || undefined, entries: p.entries, cursors };
  });
  return { agents };
}

module.exports = { parseDir };
