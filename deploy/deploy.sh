#!/usr/bin/env bash
set -Eeuo pipefail

# Run locally after pushing main. Initial provisioning is documented in README.md.
ssh root@01z.io bash -s <<'REMOTE'
set -Eeuo pipefail
export PATH="/home/deploy/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
app_dir=/var/www/orca
stamp=$(date -u +%Y%m%dT%H%M%SZ)
test -f "$app_dir/.env"
install -d -o deploy -g deploy -m 0700 /var/backups/orca

runuser -u deploy -- bash -s <<'BUILD'
set -Eeuo pipefail
cd /var/www/orca
test -z "$(git status --porcelain)" || {
  echo "Refusing to overwrite a dirty server checkout" >&2
  exit 1
}
test "$(git branch --show-current)" = main
echo "Previous revision: $(git rev-parse HEAD)"
git fetch origin main
git merge --ff-only origin/main
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build:frontend
echo "Deploying revision: $(git rev-parse HEAD)"
BUILD

# Freeze writes before the backup and migrations. A failed migration leaves the
# service stopped for inspection; database changes are never reversed here.
if systemctl is-active --quiet orca.service; then
  systemctl stop orca.service
fi
runuser -u deploy -- bash -s -- "$stamp" <<'MIGRATE'
set -Eeuo pipefail
umask 077
cd /var/www/orca
bun deploy/backup.ts "/var/backups/orca/$1.db"
bun run migrate
MIGRATE

install -o root -g root -m 0644 "$app_dir/deploy/orca.service" /etc/systemd/system/orca.service
systemctl daemon-reload
systemctl enable orca.service
systemctl restart orca.service
for attempt in {1..15}; do
  if curl --fail --silent --show-error http://127.0.0.1:6003/api/markets >/dev/null; then
    systemctl is-active --quiet orca.service
    echo "Orca is responding on 127.0.0.1:6003"
    exit 0
  fi
  sleep 1
done
echo "Orca did not become healthy; inspect journalctl -u orca.service" >&2
exit 1
REMOTE
