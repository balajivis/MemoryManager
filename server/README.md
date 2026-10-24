# Waitlist service

`waitlist.py` stores waitlist sign-ups from the landing page in SQLite. `admin.py` is a localhost-only page for viewing them. Both use the Python 3 standard library only: no pip, no virtualenv. Ubuntu 24.04's `python3` is enough.

| File | What it is |
|---|---|
| `waitlist.py` | `POST /api/waitlist` service on 127.0.0.1:8787, plus operator commands |
| `admin.py` | Admin view on 127.0.0.1:8788, started by `waitlist.py serve` |
| `test_waitlist.py`, `test_admin.py` | Tests: `python3 -m unittest server/test_waitlist.py server/test_admin.py` |

## What it stores

One row per sign-up: the email, the UTC time it was added, and `policy_version`, the privacy-policy version shown next to the form at the time. **No IP address, no user agent, no cookies.**

The service never logs email addresses. The client IP is used only as an in-memory rate-limit key and is never written to disk.

A repeat sign-up gets the same answer as a new one, so the form can't be used to check whether someone is on the list.

With JavaScript on, the page posts JSON and shows the answer inline. With JavaScript off, the form posts normally, and the service answers with a 303 redirect to `/joined.html` or `/join-error.html`. Nothing about the person goes in the URL.

## Run it locally

```sh
WAITLIST_DB=/tmp/waitlist.db python3 server/waitlist.py serve
curl -s -X POST localhost:8787/api/waitlist -H 'Content-Type: application/json' -d '{"email":"you@example.com"}'
open http://localhost:8788/            # the admin view
```

## Admin

| Task | How |
|---|---|
| Browse, search, export, delete | `ssh -L 8788:127.0.0.1:8788 <server>`, then open http://localhost:8788/ |
| Count | `python3 server/waitlist.py count` |
| Export CSV | `python3 server/waitlist.py export > waitlist.csv` |
| Delete one person (a deletion request) | `python3 server/waitlist.py delete someone@example.com` |
| Back up | `python3 server/waitlist.py backup /path/to/copy.db` (safe while running) |

**The admin view is never exposed through nginx.** It listens only on loopback. It refuses requests whose Host isn't localhost, which blocks DNS rebinding. Deletes need a per-process token and a same-site Origin, which blocks CSRF from other tabs. It sends a strict CSP and doesn't log requests.

Run the CLI commands as the service user, with the same `WAITLIST_DB` as the service.

## Settings

| Variable | Default | Notes |
|---|---|---|
| `WAITLIST_DB` | `/var/lib/memorymanager/waitlist.db` | Directory is created if missing |
| `WAITLIST_HOST`, `WAITLIST_PORT` | `127.0.0.1`, `8787` | Keep it on loopback; nginx proxies to it |
| `WAITLIST_ADMIN_PORT` | `8788` | `0` turns the admin view off |
| `WAITLIST_POLICY_VERSION` | `draft` | Set to the published policy's "last updated" date |
| `WAITLIST_RATE_LIMIT`, `WAITLIST_RATE_WINDOW` | `5`, `600` | Attempts per client per window (seconds) |

## Deploying (for devops)

These are suggestions. devops owns `deploy/` and the server.

**systemd** (`/etc/systemd/system/memorymanager-waitlist.service`):

```ini
[Unit]
Description=MemoryManager waitlist
After=network.target

[Service]
ExecStart=/usr/bin/python3 /var/www/memorymanager/current/server/waitlist.py serve
Environment=WAITLIST_DB=/var/lib/memorymanager/waitlist.db
Environment=WAITLIST_POLICY_VERSION=draft
DynamicUser=yes
StateDirectory=memorymanager
StateDirectoryMode=0700
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

**nginx**, in the `memorymanager.getkapi.com` server block. The `limit_req_zone` line goes in the `http {}` context:

```nginx
limit_req_zone $binary_remote_addr zone=waitlist:1m rate=10r/m;

location = /api/waitlist {
    limit_except POST { deny all; }
    client_max_body_size 4k;
    limit_req zone=waitlist burst=5 nodelay;
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

**Backups.** Back up the `.db` file with `waitlist.py backup`, not `cp`, because the database runs in WAL mode. Keep backups inside the retention window the privacy policy promises, so that a deleted sign-up also disappears from backups in time.
