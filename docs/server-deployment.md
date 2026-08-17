# Server Deployment Key Points

This file records the production server facts and update rules. Do not write secrets, passwords, API keys, or full connection strings here.

## Server

- Host: `108.61.0.221`
- SSH user: `root`
- OS: Ubuntu 24.04 LTS x64
- Project directory: `/opt/amazon-ad-bulk-operation`
- Public URL: `https://108-61-0-221.sslip.io`
- Internal web check URL: `http://127.0.0.1:3000`
- Credentials note path on server: `/root/amazon-ad-bulk-credentials.txt`
- Runtime env path on server: `/opt/amazon-ad-bulk-operation/.env`

## Production Architecture

- PostgreSQL runs in Docker and binds only `127.0.0.1:5432`.
- Redis runs in Docker and binds only `127.0.0.1:6379`.
- Next.js web runs as native systemd service `amazon-web`.
- Worker runs as native systemd service `amazon-worker`.
- Caddy runs in Docker with host networking and proxies HTTPS to `127.0.0.1:3000`.
- UFW allows only `22/tcp`, `80/tcp`, and `443/tcp` from the public internet.
- Caddy data must persist in Docker volumes `amazon-caddy-data` and `amazon-caddy-config`.

## Storage

- Production file storage uses Cloudflare R2.
- Server `.env` must contain `STORAGE_DRIVER=r2`.
- Production bucket name: `amazon-bulk-uploads`.
- R2/S3 credentials must only live in server `.env` or a secret manager.
- Local development can use `STORAGE_DRIVER=local` and `uploads/`.

## Update Command

From the local project root:

```bash
npm run lint
npm run build
bash scripts/deploy-native-server.sh
```

On the server, the release entry is:

```bash
cd /opt/amazon-ad-bulk-operation
bash scripts/server-native-release.sh
```

The server release script:

- Starts Docker infra: `postgres`, `redis`.
- Skips `npm ci` when `package-lock.json` is unchanged.
- Runs Prisma generate and migrate deploy.
- Seeds the bootstrap admin from server `.env`.
- Builds Next standalone.
- Restarts `amazon-web` and `amazon-worker`.
- Recreates Caddy with persistent certificate volumes.

## Never Sync Or Overwrite

Do not sync these from local to server:

- `.env`, `.env.*`
- `.git`
- `node_modules`, `node_modules.*`
- `.next`, `.next-*`
- `uploads`
- `coverage`
- `out`
- `build`

Historical broken directories such as `node_modules.broken-audit-fix-*`, `.next-build.broken-*`, and `.next-build-stale-*` must never be uploaded.

Do not delete or overwrite server runtime data:

- `/opt/amazon-ad-bulk-operation/.env`
- Docker volumes for PostgreSQL, Redis, and Caddy
- Server upload/runtime directories

## Verification Checklist

After every production update:

```bash
systemctl is-active amazon-web amazon-worker
docker compose -f /opt/amazon-ad-bulk-operation/docker-compose.yml ps
df -h /
```

External checks:

```bash
curl -k -s -o /tmp/login.json -w 'login:%{http_code}\n' \
  -c /tmp/cj \
  -H 'Content-Type: application/json' \
  -d '{"email":"1","password":"1"}' \
  https://108-61-0-221.sslip.io/api/auth/login

curl -k -s -o /tmp/me.json -w 'me:%{http_code}\n' \
  -b /tmp/cj \
  https://108-61-0-221.sslip.io/api/auth/me

curl -k -s -o /tmp/root.html -w 'root:%{http_code}:%{content_type}\n' \
  -b /tmp/cj \
  https://108-61-0-221.sslip.io/
```

Expected:

- HTTP to `http://108-61-0-221.sslip.io/` redirects to HTTPS with 308.
- Unauthenticated HTTPS `/` redirects to `https://108-61-0-221.sslip.io/login?next=%2F`.
- Login with the bootstrap account returns 200.
- `/api/auth/me` returns 200 after login.
- `/` returns 200 after login.
- Root disk should keep several GB free.

## Current Git Branch

Deployment work is currently on branch:

```bash
codex/ignore-amzn-gr-products
```
