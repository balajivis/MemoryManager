# deploy/

Server config and the deploy script for the landing page on **dev-vm** (AWS EC2 t3.micro, Ubuntu 24.04, us-east-1, Elastic IP 13.222.77.232). The page is served at `memorymanager.getkapi.com`.

Owner: devops. Follows the [release process](../docs/process/release-process.md): changes are committed on `dev`, reviewed in a PR, merged by the human, and only then deployed from `main`.

| Path | Installed to | What it does |
|---|---|---|
| `nginx/nginx.conf` | `/etc/nginx/nginx.conf` | Anonymized-IP access log; error log at `crit` sent to rsyslog; `log_not_found off`, `server_tokens off`, TLS 1.2+ |
| `rsyslog/30-nginx-anon.conf` | `/etc/rsyslog.d/` | Receives nginx errors on 127.0.0.1:5514, anonymizes IPs with `mmanon`, writes `/var/log/nginx-errors/error.log` |
| `nginx/snippets/memorymanager-site.conf` | `/etc/nginx/snippets/` | The site: root, charset, security headers, 404 page, caching |
| `nginx/sites/memorymanager-http.conf` | `/etc/nginx/sites-available/memorymanager` | Used until a TLS certificate exists: HTTP plus the Let's Encrypt challenge |
| `nginx/sites/memorymanager-https.conf` | same, once the cert exists | HTTP → HTTPS redirect, HTTPS with HSTS |
| `nginx/sites/default.conf` | `/etc/nginx/sites-available/default` | Requests by bare IP or unknown host: the test page, owner IP only |
| `logrotate/nginx` | `/etc/logrotate.d/nginx` | Daily rotation, `rotate 6` (today plus 6 days = 7 days max) for both logs |
| `systemd/memorymanager-waitlist.service` | `/etc/systemd/system/` | Waitlist API on 127.0.0.1:8787 (admin view on :8788, SSH tunnel only). `DynamicUser`, state in `/var/lib/memorymanager` (0700), heavily sandboxed (`systemd-analyze security`: 1.2 OK) |
| `systemd/memorymanager-waitlist-backup.{service,timer}` | `/etc/systemd/system/` | Nightly `waitlist.py backup` into `/var/lib/memorymanager-waitlist-backups` (0700), copies older than 7 days deleted |
| `systemd/memorymanager-waitlist-purge.{service,timer}` | `/etc/systemd/system/` | Daily `waitlist.py purge`: deletes sign-ups older than 365 days (policy: 12 months) |
| `deploy.sh` | runs on your Mac | `check`, `server`, `site`, `waitlist`, `tls`, `status` |

## Using it

```sh
deploy/deploy.sh check  <ref>      # validate a ref's config on the VM (nginx -t, logrotate -d); installs nothing
deploy/deploy.sh server <commit>   # install config; refuses commits not merged into origin/main
deploy/deploy.sh site   <commit>   # publish site/ as releases/<commit>, atomic symlink switch, keeps 5
deploy/deploy.sh waitlist <commit> <policy-date>   # install server/ (refuses 'draft': the waitlist ships with the final policy)
deploy/deploy.sh tls               # Let's Encrypt cert (webroot); then `server` switches to HTTPS once DNS is DNS only
deploy/deploy.sh status            # what's live
```

**Rollback:** run `deploy/deploy.sh site <older main commit>` or `deploy/deploy.sh server <older main commit>`. Every server install also leaves a backup in `/var/backups/mm-nginx-*.tgz`, and a failed install restores it automatically.

## Privacy facts this config guarantees

These back the sentences in `docs/pm/legal/privacy.md`. If you change them, update the policy in the same PR.

- **Access log** (`/var/log/nginx/access.log`): IP with the last IPv4 octet zeroed (IPv6 cut to /48), time, request line including the query string, status, size, referrer, user agent.
- **Error log** (`/var/log/nginx-errors/error.log`): only `crit` events, with IPs anonymized the same way by rsyslog **before** anything is written. A full IP never reaches disk.
- Both logs are deleted after 7 days (today's file plus 6 rotated files). No cookies, no analytics, nothing shipped off the box.
- `deploy.sh server` proves the first two points after every install with a self-test using documentation addresses (198.51.100.123 must appear only as 198.51.100.0).
- **Waitlist** (`/var/lib/memorymanager-waitlist/waitlist.db`): email, sign-up time, policy version. No IP or user agent; the client IP is only an in-memory rate-limit key (nginx `limit_req` plus the service's own). nginx never logs request bodies, so emails never reach the access log.
- **Waitlist backups:** nightly, kept 7 days, so a deleted sign-up is gone from every backup within 7 days. They live on the same VM (encrypted EBS), so they cover mistakes and corruption, not loss of the VM.
- **Admin:** `ssh -L 8788:127.0.0.1:8788 ubuntu@13.222.77.232`, then http://localhost:8788/. CLI as the service user: `sudo systemd-run --pipe --wait -p DynamicUser=yes -p StateDirectory=memorymanager -E WAITLIST_DB=/var/lib/memorymanager-waitlist/waitlist.db /usr/bin/python3 /opt/memorymanager-waitlist/current/waitlist.py count`
- If Cloudflare's proxy is on for the domain, the VM only sees Cloudflare's IPs, and Cloudflare processes visitor requests. The privacy policy must then name Cloudflare.
