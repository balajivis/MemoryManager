#!/usr/bin/env bash
# Deploys MemoryManager's landing page and server config to dev-vm.
# Run by devops only, from a Mac with the dev-vm SSH key. See deploy/README.md.
#
#   deploy/deploy.sh check  <ref>      validate <ref>'s server config on the VM; installs nothing (any ref)
#   deploy/deploy.sh server <commit>   install deploy/ config from <commit> (must be merged into origin/main)
#   deploy/deploy.sh site   <commit>   publish site/ from <commit> (must be merged into origin/main)
#   deploy/deploy.sh tls               get the Let's Encrypt cert, then switch nginx to HTTPS
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
  git -C "$REPO" fetch --quiet origin main
  git -C "$REPO" merge-base --is-ancestor "$1" origin/main \
    || die "$(git -C "$REPO" rev-parse --short "$1") is not merged into origin/main; deploys only come from main"
}

ship_tree() {  # ship_tree <commit> <path-in-repo> <remote-dir>
  git -C "$REPO" archive "$1:$2" | vm "rm -rf '$3' && mkdir -p '$3' && tar -x -C '$3'"
}

# Runs on the VM: validates a candidate config tree, and installs it if asked.
REMOTE_SERVER='
set -euo pipefail
src="$1"; mode="$2"; commit="$3"; domain="$4"
cert="/etc/letsencrypt/live/$domain/fullchain.pem"
site="$src/nginx/sites/memorymanager-http.conf"
[ -f "$cert" ] && site="$src/nginx/sites/memorymanager-https.conf"

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
echo "$(date -u +%FT%TZ) site $commit" | sudo tee -a "$base/DEPLOYS" >/dev/null
# keep the 5 newest releases, never the live one
ls -1t "$base/releases" | tail -n +6 | while read -r old; do
  [ "$base/releases/$old" = "$(readlink -f "$base/current")" ] || sudo rm -rf "$base/releases/$old"
done
echo "site is now $commit"
'

cmd="${1:-}"; shift || true
case "$cmd" in
  check|server)
    [ -n "${1:-}" ] || die "usage: deploy.sh $cmd <commit>"
    c="$(resolve "$1")"; short="${c:0:7}"
    [ "$cmd" = server ] && require_merged "$c"
    ship_tree "$c" deploy "/tmp/mm-deploy-$short"
    mode=check; [ "$cmd" = server ] && mode=install
    vm "bash -s -- /tmp/mm-deploy-$short $mode $short $DOMAIN" <<< "$REMOTE_SERVER"
    ;;
  site)
    [ -n "${1:-}" ] || die "usage: deploy.sh site <commit>"
    c="$(resolve "$1")"; short="${c:0:7}"
    require_merged "$c"
    ship_tree "$c" site "/tmp/mm-site-$short"
    vm "bash -s -- $short" <<< "$REMOTE_SITE"
    ;;
  tls)
    last="$(vm "tail -n 1 /etc/nginx/DEPLOYS 2>/dev/null | cut -d' ' -f3")"
    [ -n "$last" ] || die "deploy the server config first (deploy.sh server <commit>)"
    vm "sudo certbot certonly --webroot -w /var/www/letsencrypt -d $DOMAIN --non-interactive --agree-tos \
          --register-unsafely-without-email --deploy-hook 'systemctl reload nginx'"
    "$0" server "$last"   # re-install the same commit; the vhost switches to HTTPS now that the cert exists
    ;;
  status)
    vm "echo '--- server'; tail -n 3 /etc/nginx/DEPLOYS 2>/dev/null; echo '--- site'; tail -n 3 /var/www/memorymanager/DEPLOYS; echo \"current -> \$(readlink /var/www/memorymanager/current)\""
    ;;
  *) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
