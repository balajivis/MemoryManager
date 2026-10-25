#!/usr/bin/env python3
"""MemoryManager waitlist: a small HTTP service that stores sign-ups in SQLite.

Python standard library only (no pip installs). It listens on localhost, and nginx
proxies /api/waitlist to it. Privacy rules this file keeps:
  - store the email, the sign-up time and the policy version, and nothing else
    (no IP address, no user agent);
  - never write an email address to a log;
  - give the same answer for a new and an already-listed address, so the endpoint
    can't be used to check whether someone signed up.

Run the server:   python3 server/waitlist.py serve   (also starts the admin view; see admin.py)
Operator tools:   python3 server/waitlist.py count | export | delete <email> | backup <file> | purge

Settings (environment variables):
  WAITLIST_DB              SQLite file (default /var/lib/memorymanager-waitlist/waitlist.db)
  WAITLIST_HOST / _PORT    listen address (default 127.0.0.1:8787)
  WAITLIST_POLICY_VERSION  privacy-policy version shown next to the form, saved
                           with each sign-up as a record of what the person saw
  WAITLIST_RATE_LIMIT      sign-up attempts allowed per client per window (default 5)
  WAITLIST_RATE_WINDOW     window length in seconds (default 600)
  WAITLIST_RETENTION_DAYS  `purge` deletes sign-ups older than this (default 365,
                           the privacy policy's provisional 12 months)
"""

import csv
import os
import json
import os
import re
import sqlite3
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

DB_PATH = os.environ.get("WAITLIST_DB", "/var/lib/memorymanager-waitlist/waitlist.db")
HOST = os.environ.get("WAITLIST_HOST", "127.0.0.1")
PORT = int(os.environ.get("WAITLIST_PORT", "8787"))
POLICY_VERSION = os.environ.get("WAITLIST_POLICY_VERSION", "draft")
RATE_LIMIT = int(os.environ.get("WAITLIST_RATE_LIMIT", "5"))
RATE_WINDOW = int(os.environ.get("WAITLIST_RATE_WINDOW", "600"))
RETENTION_DAYS = int(os.environ.get("WAITLIST_RETENTION_DAYS", "365"))

MAX_BODY = 2048          # bytes; a sign-up is one short field
MAX_EMAIL = 254          # RFC 5321 path limit
HONEYPOT = "hp_f7q"     # hidden field that people never see; bots fill it in
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS waitlist (
  id             INTEGER PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(email) <= 254),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  policy_version TEXT NOT NULL
);
"""

# What each outcome tells the person. Copy owner: ux (docs/ux/landing/copy.md §8).
MESSAGES = {
    "joined": "You're on the list. We'll write to you when there's something to try.",
    "invalid_email": "That doesn't look like an email address. Check it and try again.",
    "rate_limited": "Too many tries from your connection. Wait a few minutes, then try again.",
    "server_error": "Something went wrong, so you're not on the list yet. Please try again in a moment.",
}

# A plain form post (JavaScript off) is redirected to a static page. Nothing about the
# person goes in the URL.
FORM_REDIRECTS = {"joined": "/joined.html"}
FORM_ERROR_PAGE = "/join-error.html"


def connect(path=None):
    conn = sqlite3.connect(path or DB_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")   # readers never block the writer
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def init_db(path=None):
    path = path or DB_PATH
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with connect(path) as conn:
        conn.executescript(SCHEMA)


def csv_safe_cell(value):
    """Stop spreadsheets running a cell as a formula (OWASP CSV injection)."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def csv_safe_row(row):
    return [csv_safe_cell(v) for v in row]


def normalize_email(raw):
    if not isinstance(raw, str):   # JSON can carry numbers, lists or null
        return None
    email = raw.strip()
    if len(email) > MAX_EMAIL or not EMAIL_RE.match(email):
        return None
    local, _, domain = email.rpartition("@")
    return f"{local}@{domain.lower()}"


def purge(days=None, path=None):
    """Delete sign-ups older than the retention period. Returns how many were removed."""
    cutoff = f"-{int(RETENTION_DAYS if days is None else days)} days"
    with connect(path) as conn:
        return conn.execute(
            "DELETE FROM waitlist WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)", (cutoff,)
        ).rowcount


def add_signup(email, path=None):
    """Store the email if it's new. Already-listed addresses are a silent no-op."""
    with connect(path) as conn:
        conn.execute(
            "INSERT OR IGNORE INTO waitlist (email, policy_version) VALUES (?, ?)",
            (email, POLICY_VERSION),
        )


class RateLimiter:
    """Fixed-window counter per client, held in memory only and never written to disk."""

    def __init__(self, limit, window):
        self.limit, self.window = limit, window
        self.hits = {}
        self.lock = threading.Lock()

    def allow(self, key):
        now = time.monotonic()
        with self.lock:
            start, count = self.hits.get(key, (now, 0))
            if now - start >= self.window:
                start, count = now, 0
            if count >= self.limit:
                return False
            self.hits[key] = (start, count + 1)
            if len(self.hits) > 10000:   # drop expired windows so memory stays bounded
                self.hits = {k: v for k, v in self.hits.items() if now - v[0] < self.window}
            return True


class Server(ThreadingHTTPServer):
    request_queue_size = 128   # the default of 5 refuses connections during a burst
    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    server_version = "waitlist"
    sys_version = ""
    timeout = 10     # seconds; a stalled client can't hold a thread open
    limiter = RateLimiter(RATE_LIMIT, RATE_WINDOW)
    db_path = None   # tests point this at a temporary file

    def log_message(self, fmt, *args):
        # nginx already keeps the (anonymized) access log. Logging here would add a
        # second copy with full client IPs, so stay quiet apart from server errors.
        pass

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/waitlist":
            return self.reply(404, "not_found")
        is_form = "application/json" not in self.headers.get("Content-Type", "")
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0:
            return self.reply(400, "invalid_email", is_form)
        if length > MAX_BODY:
            if length <= 65536:
                self.rfile.read(length)   # drain it so the client gets the 413, not a reset
            return self.reply(413, "invalid_email", is_form)
        fields = self.parse(self.rfile.read(length), is_form)
        if fields is None:
            return self.reply(400, "invalid_email", is_form)
        if fields.get(HONEYPOT):
            return self.reply(200, "joined", is_form)   # pretend success, store nothing
        # The address is a rate-limit key held in memory only. X-Real-IP is trusted only
        # from a loopback peer (nginx on this host); anyone else is keyed by their own address.
        peer = self.client_address[0]
        client = (self.headers.get("X-Real-IP") or peer) if peer in ("127.0.0.1", "::1") else peer
        if not self.limiter.allow(client):
            return self.reply(429, "rate_limited", is_form)
        email = normalize_email(fields.get("email"))
        if email is None:
            return self.reply(400, "invalid_email", is_form)
        try:
            add_signup(email, self.db_path)
        except sqlite3.Error as exc:
            sys.stderr.write(f"waitlist: database error: {type(exc).__name__}\n")
            return self.reply(500, "server_error", is_form)
        return self.reply(200, "joined", is_form)

    def do_GET(self):
        self.reply(405, "not_found")

    do_PUT = do_DELETE = do_PATCH = do_GET

    def parse(self, body, form):
        try:
            text = body.decode("utf-8")
            if form:   # a plain HTML form post, sent when JavaScript is off
                return {k: v[0] for k, v in parse_qs(text).items()}
            data = json.loads(text)
            return data if isinstance(data, dict) else None
        except (UnicodeDecodeError, ValueError):
            return None

    def reply(self, status, outcome, as_form=False):
        if as_form:
            self.send_response(303)
            self.send_header("Location", FORM_REDIRECTS.get(outcome, FORM_ERROR_PAGE))
            self.send_header("Content-Length", "0")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        message = MESSAGES.get(outcome, "")
        body = json.dumps({"ok": status == 200, "result": outcome, "message": message}).encode("utf-8")
        ctype = "application/json"
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if status == 405:
            self.send_header("Allow", "POST")
        self.end_headers()
        self.wfile.write(body)


def serve():
    init_db()
    import admin   # server/admin.py: the localhost-only admin view
    admin_httpd = admin.make_server()
    if admin_httpd:
        threading.Thread(target=admin_httpd.serve_forever, daemon=True).start()
        sys.stderr.write(f"waitlist: admin on {admin.ADMIN_HOST}:{admin.ADMIN_PORT} (localhost only; use an SSH tunnel)\n")
    httpd = Server((HOST, PORT), Handler)
    sys.stderr.write(f"waitlist: listening on {HOST}:{PORT}, db {DB_PATH}\n")
    httpd.serve_forever()


def main(argv):
    command = argv[1] if len(argv) > 1 else "serve"
    if command == "serve":
        serve()
    elif command == "count":
        init_db()
        with connect() as conn:
            print(conn.execute("SELECT count(*) FROM waitlist").fetchone()[0])
    elif command == "export":
        init_db()
        with connect() as conn:
            out = csv.writer(sys.stdout)
            out.writerow(["email", "created_at", "policy_version"])
            out.writerows(csv_safe_row(r) for r in conn.execute("SELECT email, created_at, policy_version FROM waitlist ORDER BY id"))
    elif command == "backup" and len(argv) == 3:
        init_db()
        # SQLite's online backup copies a consistent snapshot even while sign-ups are being written
        os.umask(0o077)   # the copy holds every address: owner-only
        with connect() as src, sqlite3.connect(argv[2]) as dst:
            src.backup(dst)
        print(f"backed up to {argv[2]}")
    elif command == "purge":
        init_db()
        print(f"purged {purge()} sign-ups older than {RETENTION_DAYS} days")
    elif command == "delete" and len(argv) == 3:
        init_db()
        with connect() as conn:
            gone = conn.execute("DELETE FROM waitlist WHERE email = ?", (argv[2].strip(),)).rowcount
        print("deleted" if gone else "not on the list")
    else:
        sys.stderr.write(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
