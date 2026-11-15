#!/usr/bin/env sh
set -eu

docker rm -f amazon-caddy >/dev/null 2>&1 || true
docker run -d \
  --name amazon-caddy \
  --restart unless-stopped \
  --network host \
  -v amazon-caddy-data:/data \
  -v amazon-caddy-config:/config \
  -v /opt/amazon-ad-bulk-operation/deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro \
  caddy:2-alpine
