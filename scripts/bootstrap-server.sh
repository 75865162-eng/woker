#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/amazon-ad-bulk-operation}"
RELEASES_DIR="${RELEASES_DIR:-/opt/amazon-ad-bulk-releases}"
CREDENTIALS_FILE="${CREDENTIALS_FILE:-/root/amazon-ad-bulk-credentials.txt}"
PUBLIC_HOST="${PUBLIC_HOST:-123.207.47.225}"
CI_PUBLIC_KEY_FILE="${CI_PUBLIC_KEY_FILE:-/tmp/amazon-ad-bulk-ci-deploy.pub}"

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -E bash "$0" "$@"
fi

if ! . /etc/os-release || [ "${ID:-}" != "ubuntu" ] || [ "${VERSION_ID:-}" != "24.04" ]; then
  echo "This bootstrap supports Ubuntu 24.04 only." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl docker.io docker-compose-v2 openssl ufw

if ! command -v node >/dev/null || [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup_22.sh
  bash /tmp/nodesource_setup_22.sh
  rm -f /tmp/nodesource_setup_22.sh
  apt-get install -y nodejs
fi

node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)'
docker compose version >/dev/null
systemctl enable --now docker

install -d -m 0755 "$APP_DIR" "$RELEASES_DIR"

if [ ! -f "$APP_DIR/.env" ]; then
  database_password="$(openssl rand -hex 32)"
  auth_secret="$(openssl rand -hex 32)"
  admin_password="$(openssl rand -hex 24)"
  umask 077
  cat > "$APP_DIR/.env" <<ENV
NODE_ENV=production
AUTH_DRIVER=database
AUTH_SECRET=$auth_secret
DATABASE_URL=postgresql://amazon_bulk_ad:$database_password@127.0.0.1:5432/amazon_bulk_ad?schema=public
POSTGRES_DB=amazon_bulk_ad
POSTGRES_USER=amazon_bulk_ad
POSTGRES_PASSWORD=$database_password
REDIS_URL=redis://127.0.0.1:6379
QUEUE_DRIVER=redis
WORKER_CONCURRENCY=1
PRODUCT_OUTBOX_WORKER_CONCURRENCY=1
IMAGE_UPSCALE_WORKER_CONCURRENCY=1
AMAZON_SYNC_WORKER_CONCURRENCY=1
STORAGE_DRIVER=local
UPLOAD_DIR=uploads
BOOTSTRAP_ORG_NAME=Amazon Operations
BOOTSTRAP_ORG_SLUG=amazon-ops
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=$admin_password
AMAZON_ADS_EXECUTION_ENABLED=false
NEXT_TELEMETRY_DISABLED=1
ENV
  chmod 0600 "$APP_DIR/.env"

  cat > "$CREDENTIALS_FILE" <<CREDS
Amazon Bulk Ad initial administrator
URL: http://$PUBLIC_HOST/
Email: admin@example.com
Password: $admin_password
Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
CREDS
  chmod 0600 "$CREDENTIALS_FILE"
elif [ ! -f "$CREDENTIALS_FILE" ]; then
  echo "Existing .env preserved; refusing to invent or overwrite administrator credentials." >&2
  exit 1
fi

if [ -f "$CI_PUBLIC_KEY_FILE" ]; then
  install -d -m 0700 -o ubuntu -g ubuntu /home/ubuntu/.ssh
  touch /home/ubuntu/.ssh/authorized_keys
  chown ubuntu:ubuntu /home/ubuntu/.ssh/authorized_keys
  chmod 0600 /home/ubuntu/.ssh/authorized_keys
  ci_public_key="$(tr -d '\r\n' < "$CI_PUBLIC_KEY_FILE")"
  if ! grep -qxF "$ci_public_key" /home/ubuntu/.ssh/authorized_keys; then
    printf '%s\n' "$ci_public_key" >> /home/ubuntu/.ssh/authorized_keys
  fi
  rm -f "$CI_PUBLIC_KEY_FILE"
fi

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

printf 'Bootstrap complete. Node %s; Docker Compose %s.\n' "$(node --version)" "$(docker compose version --short)"
