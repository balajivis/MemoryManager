"""Admin view of the MemoryManager waitlist: browse, search, export and delete sign-ups.

It runs inside the waitlist process (python3 server/waitlist.py serve) on its own port,
and it only ever listens on localhost. nginx never proxies it, so there's no public
login page to attack. To use it from your machine, open an SSH tunnel:

    ssh -L 8788:127.0.0.1:8788 <server>      then browse to http://localhost:8788/

Even on localhost, a web page you visit could try to reach it, so the admin also:
  - answers only requests addressed to localhost:<port> (blocks DNS rebinding);
  - requires a per-process token on every delete, and rejects cross-site Origins (blocks CSRF);
  - sends a strict Content-Security-Policy, no-store and frame-blocking headers;
  - never logs requests, since search terms and deletions name people.

Settings: WAITLIST_ADMIN_PORT (default 8788; 0 turns the admin off).
"""

import csv
import html
import io
import ipaddress
import os
import secrets
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlencode, urlsplit

import waitlist

ADMIN_HOST = "127.0.0.1"
ADMIN_PORT = int(os.environ.get("WAITLIST_ADMIN_PORT", "8788"))
PAGE_SIZE = 100


def esc(value):
    return html.escape(str(value), quote=True)


def like_pattern(q):
    q = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{q}%"


class AdminHandler(BaseHTTPRequestHandler):
    server_version = "waitlist-admin"
    sys_version = ""
    timeout = 30
    db_path = None                        # tests point this at a temporary file
    token = secrets.token_urlsafe(32)     # new every restart; only this process's pages carry it

    def log_message(self, fmt, *args):
        pass

    # --- request guards -------------------------------------------------------

    def allowed_hosts(self):
        port = self.server.server_address[1]
        return {f"127.0.0.1:{port}", f"localhost:{port}"}

    def guard(self):
        """True if the request may proceed; otherwise sends 403 and returns False."""
        if self.headers.get("Host", "") not in self.allowed_hosts():
            self.send_page(403, "Forbidden", "<p>This admin only answers on localhost.</p>")
            return False
        origin = self.headers.get("Origin")
        if origin and urlsplit(origin).netloc not in self.allowed_hosts():
            self.send_page(403, "Forbidden", "<p>Cross-site requests aren't allowed.</p>")
            return False
        return True

    # --- routes ---------------------------------------------------------------

    def do_GET(self):
        if not self.guard():
            return
        url = urlsplit(self.path)
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == "/":
            self.list_page(query)
        elif url.path == "/export.csv":
            self.export()
        elif url.path == "/confirm":
            self.confirm_page(query)
        else:
            self.send_page(404, "Not found", '<p><a href="/">Back to the waitlist</a></p>')

    def do_POST(self):
        if not self.guard():
            return
        if urlsplit(self.path).path != "/delete":
            return self.send_page(404, "Not found", '<p><a href="/">Back to the waitlist</a></p>')
        try:
            length = max(0, int(self.headers.get("Content-Length") or 0))
        except ValueError:
            length = 0
        fields = {k: v[0] for k, v in parse_qs(self.rfile.read(min(length, 4096)).decode("utf-8", "replace")).items()}
        if not secrets.compare_digest(fields.get("token", ""), self.token):
            return self.send_page(403, "Forbidden", "<p>This delete link has expired. Reload the waitlist and try again.</p>")
        try:
            signup_id = int(fields.get("id", ""))
        except ValueError:
            return self.send_page(400, "Bad request", '<p><a href="/">Back to the waitlist</a></p>')
        with waitlist.connect(self.db_path) as conn:
            gone = conn.execute("DELETE FROM waitlist WHERE id = ?", (signup_id,)).rowcount
        self.send_response(303)
        self.send_header("Location", "/?" + urlencode({"notice": "deleted" if gone else "missing"}))
        self.security_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    # --- pages ----------------------------------------------------------------

    def list_page(self, query):
        q = query.get("q", "").strip()
        try:
            page = max(1, int(query.get("page", "1")))
        except ValueError:
            page = 1
        where, args = ("WHERE email LIKE ? ESCAPE '\\'", [like_pattern(q)]) if q else ("", [])
        week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
        with waitlist.connect(self.db_path) as conn:
            total = conn.execute("SELECT count(*) FROM waitlist").fetchone()[0]
            recent = conn.execute("SELECT count(*) FROM waitlist WHERE created_at >= ?", (week_ago,)).fetchone()[0]
            matches = conn.execute(f"SELECT count(*) FROM waitlist {where}", args).fetchone()[0]
            rows = conn.execute(
                f"SELECT id, email, created_at, policy_version FROM waitlist {where} "
                "ORDER BY id DESC LIMIT ? OFFSET ?", args + [PAGE_SIZE, (page - 1) * PAGE_SIZE]).fetchall()

        notice = {"deleted": "Deleted. That sign-up is gone from the waitlist.",
                  "missing": "That sign-up was already gone."}.get(query.get("notice", ""))
        parts = [f'<p class="notice" role="status">{esc(notice)}</p>' if notice else ""]
        parts.append(f"""
<div class="stats">
  <div><span class="num">{total}</span><span class="lbl">on the waitlist</span></div>
  <div><span class="num">{recent}</span><span class="lbl">joined in the last 7 days</span></div>
</div>
<div class="bar">
  <form method="get" action="/" role="search">
    <label for="q">Search emails</label>
    <input id="q" name="q" type="search" value="{esc(q)}" placeholder="name or domain">
    <button type="submit">Search</button>
    {'<a href="/">Clear</a>' if q else ''}
  </form>
  <a class="button" href="/export.csv">Export CSV</a>
</div>""")
        if not rows:
            parts.append(f'<p class="empty">{"No sign-ups match that search." if q else "No one has joined yet."}</p>')
        else:
            body = "".join(
                f"<tr><td>{esc(email)}</td><td>{esc(created.replace('T', ' ').rstrip('Z'))} UTC</td>"
                f"<td>{esc(version)}</td><td><a href=\"/confirm?id={sid}\">Delete…</a></td></tr>"
                for sid, email, created, version in rows)
            caption = f"{matches} matching “{esc(q)}”" if q else "Newest first"
            parts.append(f"""
<div class="table-wrap">
<table>
  <caption>{caption}</caption>
  <thead><tr><th scope="col">Email</th><th scope="col">Joined</th><th scope="col">Policy version</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
  <tbody>{body}</tbody>
</table>
</div>""")
            pages = max(1, -(-matches // PAGE_SIZE))
            if pages > 1:
                link = lambda p: "/?" + urlencode({k: v for k, v in (("q", q), ("page", p)) if v})
                prev_link = f'<a href="{esc(link(page - 1))}">← Newer</a>' if page > 1 else "<span></span>"
                next_link = f'<a href="{esc(link(page + 1))}">Older →</a>' if page < pages else "<span></span>"
                parts.append(f'<nav class="pager" aria-label="Pages">{prev_link}<span>Page {page} of {pages}</span>{next_link}</nav>')
        self.send_page(200, "Waitlist", "".join(parts))

    def confirm_page(self, query):
        try:
            signup_id = int(query.get("id", ""))
        except ValueError:
            signup_id = -1
        with waitlist.connect(self.db_path) as conn:
            row = conn.execute("SELECT email, created_at FROM waitlist WHERE id = ?", (signup_id,)).fetchone()
        if not row:
            return self.send_page(404, "Not found", '<p>That sign-up is already gone. <a href="/">Back to the waitlist</a></p>')
        email, created = row
        self.send_page(200, "Delete sign-up", f"""
<div class="confirm">
  <p>Delete <strong>{esc(email)}</strong> (joined {esc(created.replace('T', ' ').rstrip('Z'))} UTC) from the waitlist?</p>
  <p class="hint">Use this for deletion requests. It removes the email for good, and it can't be undone.</p>
  <form method="post" action="/delete">
    <input type="hidden" name="id" value="{signup_id}">
    <input type="hidden" name="token" value="{esc(self.token)}">
    <button type="submit" class="danger">Delete for good</button>
    <a href="/">Cancel</a>
  </form>
</div>""")

    def export(self):
        with waitlist.connect(self.db_path) as conn:
            rows = conn.execute("SELECT email, created_at, policy_version FROM waitlist ORDER BY id").fetchall()
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(["email", "created_at", "policy_version"])
        writer.writerows(rows)
        body = out.getvalue().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="waitlist-{datetime.now(timezone.utc):%Y%m%d}.csv"')
        self.send_header("Content-Length", str(len(body)))
        self.security_headers()
        self.end_headers()
        self.wfile.write(body)

    # --- output ---------------------------------------------------------------

    def security_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy",
                         "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")

    def send_page(self, status, title, content):
        body = PAGE.format(title=esc(title), content=content).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.security_headers()
        self.end_headers()
        self.wfile.write(body)


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{title} · MemoryManager admin</title>
<style>
  :root {{ --bg: #faf8f4; --surface: #fff; --ink: #1c1b19; --muted: #6b675f; --line: #e6e1d8; --accent: #1f5e5b;
          --accent-ink: #fff; --danger: #a3261b; --tint: rgba(31, 94, 91, .08); color-scheme: light; }}
  @media (prefers-color-scheme: dark) {{
    :root {{ --bg: #141413; --surface: #1d1c1a; --ink: #edeae4; --muted: #a39e94; --line: #2e2c29; --accent: #6fc2ba;
            --accent-ink: #0e1f1e; --danger: #ff8a7a; --tint: rgba(111, 194, 186, .1); color-scheme: dark; }}
  }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 0 16px 48px; }}
  .wrap {{ max-width: 960px; margin: 0 auto; }}
  header {{ display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 20px 0; border-bottom: 1px solid var(--line); margin-bottom: 24px; }}
  header a {{ color: var(--ink); text-decoration: none; font-weight: 600; font-size: 1.1rem; }}
  header span {{ color: var(--muted); font-size: .85rem; }}
  h1 {{ font-size: 1.5rem; margin: 0 0 16px; }}
  a {{ color: var(--accent); }}
  :focus-visible {{ outline: 2px solid var(--accent); outline-offset: 2px; }}
  .stats {{ display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }}
  .stats div {{ background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; min-width: 180px; display: grid; }}
  .num {{ font-size: 1.75rem; font-weight: 600; font-variant-numeric: tabular-nums; }}
  .lbl {{ color: var(--muted); font-size: .85rem; }}
  .bar {{ display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 16px; }}
  .bar form {{ display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }}
  label {{ font-size: .85rem; color: var(--muted); }}
  input[type=search] {{ font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--muted); border-radius: 8px; padding: 7px 10px; min-width: 0; width: 240px; max-width: 100%; }}
  button, .button {{ font: inherit; font-weight: 600; border: 0; border-radius: 8px; padding: 8px 14px; background: var(--accent); color: var(--accent-ink); cursor: pointer; text-decoration: none; }}
  button.danger {{ background: var(--danger); color: var(--bg); }}
  .table-wrap {{ overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }}
  table {{ width: 100%; border-collapse: collapse; }}
  caption {{ text-align: left; padding: 10px 14px; color: var(--muted); font-size: .85rem; }}
  th, td {{ text-align: left; padding: 9px 14px; border-top: 1px solid var(--line); white-space: nowrap; }}
  th {{ font-size: .8rem; color: var(--muted); font-weight: 600; }}
  td:first-child {{ white-space: normal; word-break: break-all; }}
  td:nth-child(2) {{ font-variant-numeric: tabular-nums; }}
  .pager {{ display: flex; justify-content: space-between; align-items: center; margin-top: 14px; color: var(--muted); }}
  .notice {{ background: var(--tint); border-radius: 8px; padding: 10px 14px; }}
  .empty {{ color: var(--muted); padding: 24px 0; }}
  .confirm {{ background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 20px; max-width: 560px; }}
  .confirm form {{ display: flex; align-items: center; gap: 16px; margin-top: 16px; }}
  .hint {{ color: var(--muted); font-size: .9rem; }}
  .sr {{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }}
</style>
</head>
<body>
<div class="wrap">
  <header><a href="/">MemoryManager waitlist</a><span>Admin · localhost only</span></header>
  <h1>{title}</h1>
  {content}
</div>
</body>
</html>
"""


def make_server():
    """The admin server, or None when turned off. Refuses any non-loopback address."""
    if ADMIN_PORT == 0:
        return None
    if not ipaddress.ip_address(ADMIN_HOST).is_loopback:
        raise SystemExit("waitlist admin must listen on a loopback address")
    return waitlist.Server((ADMIN_HOST, ADMIN_PORT), AdminHandler)
