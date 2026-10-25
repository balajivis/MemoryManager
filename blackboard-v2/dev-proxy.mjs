// Dev front door (node built-ins only): serves web/out under /board/ and proxies /board/api (incl. WebSocket) to the server.
// Usage: node dev-proxy.mjs [listenPort=8780] [serverPort=8790]
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web', 'out');
const LISTEN = Number(process.argv[2] || process.env.PROXY_PORT || 8780);
const UPSTREAM = Number(process.argv[3] || process.env.PORT || 8790);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json' };

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname).replace(/^\/board/, '') || '/';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  const candidates = [file, path.join(file, 'index.html'), file + '.html'];
  const hit = candidates.find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  const send = (f, code) => {
    res.writeHead(code, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'X-Robots-Tag': 'noindex' });
    fs.createReadStream(f).pipe(res);
  };
  if (hit) return send(hit, 200);
  const nf = path.join(ROOT, '404.html');
  if (fs.existsSync(nf)) return send(nf, 404);
  res.writeHead(404).end('not found');
}

const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/' ) { res.writeHead(302, { Location: '/board/' }).end(); return; }
  if (p === '/board') { res.writeHead(302, { Location: '/board/' }).end(); return; }
  if (p.startsWith('/board/api/') || p === '/board/api') {
    const up = http.request({ host: '127.0.0.1', port: UPSTREAM, method: req.method, path: req.url, headers: req.headers }, (ur) => {
      res.writeHead(ur.statusCode, ur.headers);
      ur.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":"bad_gateway"}'); });
    req.pipe(up);
    return;
  }
  if (p.startsWith('/board/')) return serveStatic(req, res);
  res.writeHead(404).end('not found');
});

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/board/api/')) { socket.destroy(); return; }
  const up = net.connect(UPSTREAM, '127.0.0.1', () => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    up.write(raw + '\r\n');
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
  socket.on('close', () => up.destroy());
});

server.listen(LISTEN, '127.0.0.1', () => console.log(`dev-proxy http://127.0.0.1:${LISTEN}/board/ -> api 127.0.0.1:${UPSTREAM}`));
