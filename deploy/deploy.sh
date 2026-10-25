#!/usr/bin/env bash
# Deploys MemoryManager's landing page and server config to dev-vm.
# Run by devops only, from a Mac with the dev-vm SSH key. See deploy/README.md.
#
#   deploy/deploy.sh check  <ref>      validate <ref>'s server config on the VM; installs nothing (any ref)
#   deploy/deploy.sh server <commit>   install deploy/ config from <commit> (must be merged into origin/main)
#   deploy/deploy.sh site   <commit>   publish site/ from <commit> (must be merged into origin/main)
#   deploy/deploy.sh waitlist <commit> <policy-date>   install server/ (waitlist service) from <commit>
#   deploy/deploy.sh tls               get the Let's Encrypt cert (works even while Cloudflare proxies)
#   deploy/deploy.sh status            show what's deployed
#
# DEPLOY_HOST and DEPLOY_KEY override the target.
set -euo pipefail

HOST="${DEPLOY_HOST:-ubuntu@13.222.77.232}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/dev-vm-key.pem}"
DOMAIN="memorymanager.getkapi.com"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { echo "deploy: $*" >&2; exit 1; }
vm()  { ssh -i "$KEY" -o ConnectTimeout=15 -o BatchMode=yes "$HOST" "$@"; }

resolve() {  # full hash of a ref, or die
  git -C "$REPO" rev-parse --verify --quiet "$1^{commit}" || die "unknown ref '$1'"
}

require_merged() {  # deploys only ever come from main (docs/process/release-process.md)
  # DEPLOY_FROM_DEV=1: the user's one-day exception (2026-10-25, Blackboard v2 classroom deploy)
  [ "${DEPLOY_FROM_DEV:-}" = 1 ] && { echo "deploy: DEPLOY_FROM_DEV=1, deploying an unmerged commit (user exception)"; return 0; }
  git -C "$REPO" fetch --quiet origin main
  git -C "$REPO" merge-base --is-ancestor "$1" origin/main \
    || die "$(git -C "$REPO" rev-parse --short "$1") is not merged into origin/main; deploys only come from main"
}

guard_https() {  # an HTTPS vhost behind Cloudflare's Flexible proxy would redirect-loop
  [ "${FORCE_HTTP_VHOST:-}" = 1 ] && return 0                            # explicitly staying on the HTTP vhost
  vm "test -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem" || return 0   # no cert yet: HTTP vhost, always safe
  local ip="${HOST#*@}"
  dig +short "$DOMAIN" A | grep -qx "$ip" && return 0
  [ "${ALLOW_PROXIED:-}" = 1 ] && { echo "deploy: ALLOW_PROXIED=1, installing HTTPS vhost anyway"; return 0; }
  die "a cert exists, so this install switches to HTTPS, but $DOMAIN resolves to $(dig +short "$DOMAIN" A | tr '\n' ' ')not $ip.
That's Cloudflare's proxy; an origin HTTPS redirect behind it loops. Set the record to DNS only first."
}

ship_tree() {  # ship_tree <commit> <path-in-repo> <remote-dir>
  git -C "$REPO" archive "$1:$2" | vm "rm -rf '$3' && mkdir -p '$3' && tar -x -C '$3'"
}

# Runs on the VM: validates a candidate config tree, and installs it if asked.
REMOTE_SERVER='
set -euo pipefail
src="$1"; mode="$2"; commit="$3"; domain="$4"; force_http="${5:-}"
cert="/etc/letsencrypt/live/$domain/fullchain.pem"
site="$src/nginx/sites/memorymanager-http.conf"
[ -f "$cert" ] && [ "$force_http" != 1 ] && site="$src/nginx/sites/memorymanager-https.conf"

# 1. Test the candidate in a scratch tree, with includes pointed at the candidate files.
t="$src/.test"; rm -rf "$t"; mkdir -p "$t/sites-enabled"
sed -e "s#/etc/nginx/sites-enabled/\*#$t/sites-enabled/*#" -e "s#include /etc/nginx/conf.d/\*.conf;##" \
    "$src/nginx/nginx.conf" > "$t/nginx.conf"
for f in "$src/nginx/sites/default.conf" "$site"; do
  sed "s#/etc/nginx/snippets/memorymanager-site.conf#$src/nginx/snippets/memorymanager-site.conf#" "$f" > "$t/sites-enabled/$(basename "$f")"
done
sudo nginx -t -q -c "$t/nginx.conf" || { echo "candidate config FAILED nginx -t"; exit 1; }
if [ ! -f "$cert" ]; then   # also prove the HTTPS vhost parses, using a throwaway self-signed cert
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$domain" -keyout "$t/k.pem" -out "$t/c.pem" 2>/dev/null
  rm -f "$t/sites-enabled/"*.conf
  cp "$src/nginx/sites/default.conf" "$t/sites-enabled/default.conf"
  sed -e "s#/etc/nginx/snippets/memorymanager-site.conf#$src/nginx/snippets/memorymanager-site.conf#" \
      -e "s#/etc/letsencrypt/live/$domain/fullchain.pem#$t/c.pem#" -e "s#/etc/letsencrypt/live/$domain/privkey.pem#$t/k.pem#" \
      "$src/nginx/sites/memorymanager-https.conf" > "$t/sites-enabled/https.conf"
  sudo nginx -t -q -c "$t/nginx.conf" || { echo "candidate HTTPS vhost FAILED nginx -t"; exit 1; }
fi
sudo logrotate -d "$src/logrotate/nginx" >/dev/null 2>&1 || { echo "candidate logrotate config FAILED"; exit 1; }
# AppArmor lets rsyslogd read config only under /etc/rsyslog.d, so check a copy there under a
# name the live '*.conf' include never loads, then remove it.
rcheck=/etc/rsyslog.d/.candidate-nginx-anon.check
sudo install -m 644 "$src/rsyslog/30-nginx-anon.conf" "$rcheck"
if ! sudo rsyslogd -N1 -f "$rcheck" >/dev/null 2>&1; then
  echo "candidate rsyslog config FAILED"; sudo rsyslogd -N1 -f "$rcheck"; sudo rm -f "$rcheck"; exit 1
fi
sudo rm -f "$rcheck"
echo "candidate OK: nginx -t (HTTP and HTTPS vhosts), logrotate -d and rsyslogd -N1 pass; will install $(basename "$site")"
[ "$mode" = install ] || exit 0

# 2. Back up, install, re-test the live config, reload. Restore the backup on any failure.
bak="/var/backups/mm-nginx-$(date -u +%Y%m%dT%H%M%SZ).tgz"
sudo tar --ignore-failed-read -czf "$bak" -C / etc/nginx etc/logrotate.d/nginx etc/rsyslog.d/30-nginx-anon.conf 2>/dev/null
restore() {
  echo "install FAILED; restoring $bak"
  sudo rm -rf /etc/nginx; sudo rm -f /etc/rsyslog.d/30-nginx-anon.conf; sudo tar -xzf "$bak" -C /
  sudo systemctl restart rsyslog; sudo nginx -t -q && sudo systemctl reload nginx; exit 1
}
trap restore ERR
sudo install -m 644 "$src/nginx/nginx.conf" /etc/nginx/nginx.conf
sudo install -d /etc/nginx/snippets /var/www/letsencrypt
sudo install -m 644 "$src/nginx/snippets/memorymanager-site.conf" /etc/nginx/snippets/memorymanager-site.conf
sudo install -m 644 "$src/nginx/sites/default.conf" /etc/nginx/sites-available/default
sudo install -m 644 "$site" /etc/nginx/sites-available/memorymanager
sudo ln -sfn /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
sudo ln -sfn /etc/nginx/sites-available/memorymanager /etc/nginx/sites-enabled/memorymanager
sudo rm -f /etc/nginx/conf.d/hardening.conf   # superseded by server_tokens in nginx.conf
sudo install -m 644 "$src/logrotate/nginx" /etc/logrotate.d/nginx
sudo install -d -o syslog -g adm -m 750 /var/log/nginx-errors
sudo install -m 644 "$src/rsyslog/30-nginx-anon.conf" /etc/rsyslog.d/30-nginx-anon.conf
sudo rsyslogd -N1 >/dev/null 2>&1
sudo systemctl restart rsyslog          # the anonymizing error-log receiver must be up before nginx reloads
sudo nginx -t -q
sudo systemctl reload nginx
trap - ERR

# 3. Self-test the privacy guarantees with documentation-only addresses (RFC 5737).
sleep 1
logger --udp -n 127.0.0.1 -P 5514 -t nginx "deploy-selftest $commit client: 198.51.100.123, server: selftest"
curl -s -o /dev/null -H "Host: $domain" "http://127.0.0.1/?deploy-selftest-$commit"
sleep 1
if sudo grep -q "deploy-selftest $commit client: 198.51.100.0," /var/log/nginx-errors/error.log \
   && ! sudo grep -q "198.51.100.123" /var/log/nginx-errors/error.log; then
  echo "selftest OK: error log stores 198.51.100.0, not the full address"
else
  echo "SELFTEST FAILED: error log is not anonymized"; exit 1
fi
if sudo tail -n 200 /var/log/nginx/access.log | grep "deploy-selftest-$commit" | grep -q "^127\.0\.0\.0 "; then
  echo "selftest OK: access log stores 127.0.0.0, not 127.0.0.1"
else
  echo "SELFTEST FAILED: access log is not anonymized"; exit 1
fi
echo "$(date -u +%FT%TZ) server $commit $(basename "$site")" | sudo tee -a /etc/nginx/DEPLOYS >/dev/null
echo "installed server config from $commit (backup: $bak)"
'

REMOTE_SITE='
set -euo pipefail
commit="$1"; base=/var/www/memorymanager; rel="$base/releases/$commit"
sudo mkdir -p "$base/releases"
sudo rm -rf "$rel.tmp"; sudo mv "/tmp/mm-site-$commit" "$rel.tmp"
sudo chown -R root:root "$rel.tmp"
sudo find "$rel.tmp" -type d -exec chmod 755 {} +
sudo find "$rel.tmp" -type f -exec chmod 644 {} +
sudo rm -rf "$rel"; sudo mv "$rel.tmp" "$rel"
sudo ln -sfn "$rel" "$base/current.new" && sudo mv -T "$base/current.new" "$base/current"   # atomic switch
# CSP from this release: hash every inline <script> and <style> in its HTML pages
python3 - "$rel" <<"PY" | sudo tee /etc/nginx/snippets/memorymanager-csp.conf >/dev/null
import base64, glob, hashlib, re, sys
h = lambda s: "\x27sha256-" + base64.b64encode(hashlib.sha256(s.encode()).digest()).decode() + "\x27"
js, css = set(), set()
for f in glob.glob(sys.argv[1] + "/**/*.html", recursive=True):
    t = open(f, encoding="utf-8").read()
    js |= {h(m) for m in re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", t, re.S)}
    css |= {h(m) for m in re.findall(r"<style[^>]*>(.*?)</style>", t, re.S)}
pol = ("default-src \x27self\x27; script-src \x27self\x27 %s; style-src \x27self\x27 %s; img-src \x27self\x27 data:; "
       "font-src \x27self\x27; connect-src \x27self\x27; form-action \x27self\x27; frame-ancestors \x27self\x27; "
       "base-uri \x27none\x27; object-src \x27none\x27") % (" ".join(sorted(js)), " ".join(sorted(css)))
print("add_header Content-Security-Policy \"%s\" always;" % pol)
PY
sudo nginx -t -q && sudo systemctl reload nginx
echo "$(date -u +%FT%TZ) site $commit" | sudo tee -a "$base/DEPLOYS" >/dev/null
# keep the 5 newest releases, never the live one
ls -1t "$base/releases" | tail -n +6 | while read -r old; do
  [ "$base/releases/$old" = "$(readlink -f "$base/current")" ] || sudo rm -rf "$base/releases/$old"
done
echo "site is now $commit"
'

REMOTE_WAITLIST='
set -euo pipefail
commit="$1"; policy="$2"; base=/opt/memorymanager-waitlist; rel="$base/releases/$commit"
sudo mkdir -p "$base/releases"
sudo rm -rf "$rel"; sudo mv "/tmp/mm-waitlist-$commit/server" "$rel"
sudo chown -R root:root "$rel"; sudo find "$rel" -type d -exec chmod 755 {} +; sudo find "$rel" -type f -exec chmod 644 {} +
sudo ln -sfn "$rel" "$base/current.new" && sudo mv -T "$base/current.new" "$base/current"
for u in memorymanager-waitlist.service memorymanager-waitlist-backup.service memorymanager-waitlist-backup.timer \
         memorymanager-waitlist-purge.service memorymanager-waitlist-purge.timer; do
  sudo install -m 644 "/tmp/mm-waitlist-$commit/systemd/$u" "/etc/systemd/system/$u"
done
sudo install -d /etc/systemd/system/memorymanager-waitlist.service.d
printf "[Service]\nEnvironment=WAITLIST_POLICY_VERSION=%s\n" "$policy" | sudo tee /etc/systemd/system/memorymanager-waitlist.service.d/policy.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now memorymanager-waitlist-backup.timer memorymanager-waitlist-purge.timer >/dev/null
sudo systemctl enable memorymanager-waitlist.service >/dev/null
sudo systemctl restart memorymanager-waitlist.service
sleep 2
systemctl is-active --quiet memorymanager-waitlist.service || { echo "waitlist service FAILED to start"; sudo journalctl -u memorymanager-waitlist -n 20 --no-pager; exit 1; }
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8787/api/waitlist)
echo "$(date -u +%FT%TZ) waitlist $commit policy=$policy" | sudo tee -a "$base/DEPLOYS" >/dev/null
echo "waitlist is now $commit (policy $policy); GET /api/waitlist on loopback -> $code"
sudo rm -rf "/tmp/mm-waitlist-$commit"
'

cmd="${1:-}"; shift || true
case "$cmd" in
  check|server)
    [ -n "${1:-}" ] || die "usage: deploy.sh $cmd <commit>"
    c="$(resolve "$1")"; short="${c:0:7}"
    [ "$cmd" = server ] && { require_merged "$c"; guard_https; }
    ship_tree "$c" deploy "/tmp/mm-deploy-$short"
    mode=check; [ "$cmd" = server ] && mode=install
    vm "bash -s -- /tmp/mm-deploy-$short $mode $short $DOMAIN ${FORCE_HTTP_VHOST:-0}" <<< "$REMOTE_SERVER"
    ;;
  site)
    [ -n "${1:-}" ] || die "usage: deploy.sh site <commit>"
    c="$(resolve "$1")"; short="${c:0:7}"
    require_merged "$c"
    ship_tree "$c" site "/tmp/mm-site-$short"
    vm "bash -s -- $short" <<< "$REMOTE_SITE"
    ;;
  waitlist)
    [ -n "${1:-}" ] && [ -n "${2:-}" ] || die "usage: deploy.sh waitlist <commit> <policy-date, e.g. 2026-10-25>"
    [ "$2" = draft ] && [ "${ALLOW_DRAFT_POLICY:-}" != 1 ] \
      && die "policy is 'draft': the waitlist goes live only with the final privacy policy (pm gate)"
    c="$(resolve "$1")"; short="${c:0:7}"
    require_merged "$c"
    git -C "$REPO" archive --format=tar "$c" server deploy/systemd \
      | vm "rm -rf /tmp/mm-waitlist-$short && mkdir -p /tmp/mm-waitlist-$short && tar -x -C /tmp/mm-waitlist-$short && mv /tmp/mm-waitlist-$short/deploy/systemd /tmp/mm-waitlist-$short/systemd"
    vm "bash -s -- $short $2" <<< "$REMOTE_WAITLIST"
    ;;
  tls)
    last="$(vm "tail -n 1 /etc/nginx/DEPLOYS 2>/dev/null | cut -d' ' -f3")"
    [ -n "$last" ] || die "deploy the server config first (deploy.sh server <commit>)"
    vm "sudo certbot certonly --webroot -w /var/www/letsencrypt -d $DOMAIN --non-interactive --agree-tos \
          --register-unsafely-without-email --deploy-hook 'systemctl reload nginx'"
    echo "cert issued. Once $DOMAIN is DNS only (resolves to ${HOST#*@}), run: deploy/deploy.sh server $last"
    ;;
  status)
    vm "echo '--- server'; tail -n 3 /etc/nginx/DEPLOYS 2>/dev/null; echo '--- site'; tail -n 3 /var/www/memorymanager/DEPLOYS; echo \"current -> \$(readlink /var/www/memorymanager/current)\""
    ;;
  *) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
