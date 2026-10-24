# deploy/

Server config and the deploy script for the landing page on **dev-vm** (AWS EC2 t3.micro, Ubuntu 24.04, us-east-1, Elastic IP 13.222.77.232). The page is served at `memorymanager.getkapi.com`.

Owner: devops. Follows the [release process](../docs/process/release-process.md): changes are committed on `dev`, reviewed in a PR, merged by the human, and only then deployed from `main`.

| Path | Installed to | What it does |
|---|---|---|
| `nginx/nginx.conf` | `/etc/nginx/nginx.conf` | Anonymized-IP access log, error log at `crit`, `log_not_found off`, `server_tokens off`, TLS 1.2+ |
| `nginx/snippets/memorymanager-site.conf` | `/etc/nginx/snippets/` | The site: root, charset, security headers, 404 page, caching |
| `nginx/sites/memorymanager-http.conf` | `/etc/nginx/sites-available/memorymanager` | Used until a TLS certificate exists: HTTP plus the Let's Encrypt challenge |
| `nginx/sites/memorymanager-https.conf` | same, once the cert exists | HTTP → HTTPS redirect, HTTPS with HSTS |
| `nginx/sites/default.conf` | `/etc/nginx/sites-available/default` | Requests by bare IP or unknown host: the test page, owner IP only |
| `logrotate/nginx` | `/etc/logrotate.d/nginx` | Daily rotation, 7 days kept; shortens IPs in the rotated error log |
| `deploy.sh` | runs on your Mac | `check`, `server`, `site`, `tls`, `status` |

## Using it

```sh
deploy/deploy.sh check  <ref>      # validate a ref's config on the VM (nginx -t, logrotate -d); installs nothing
deploy/deploy.sh server <commit>   # install config; refuses commits not merged into origin/main
deploy/deploy.sh site   <commit>   # publish site/ as releases/<commit>, atomic symlink switch, keeps 5
deploy/deploy.sh tls               # Let's Encrypt cert (webroot), then switch the vhost to HTTPS
deploy/deploy.sh status            # what's live
```

**Rollback:** run `deploy/deploy.sh site <older main commit>` or `deploy/deploy.sh server <older main commit>`. Every server install also leaves a backup in `/var/backups/mm-nginx-*.tgz`, and a failed install restores it automatically.

## Privacy facts this config guarantees

These back the sentences in `docs/pm/legal/privacy.md`. If you change them, update the policy in the same PR.

- The access log stores IPs with the last IPv4 octet zeroed (IPv6 cut to /48), plus the time, request line (including the query string), status, size, referrer and user agent.
- The error log records only `crit` events. Rare connection errors can include a full IP, which the daily rotation shortens within 24 hours.
- Both logs are deleted after 7 days. No cookies, no analytics, nothing shipped off the box.
