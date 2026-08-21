#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_PATH="${ARTIFACT_PATH:-dist/amazon-ad-bulk-operation-release.tar.gz}"
WORK_DIR="$(mktemp -d)"
PACKAGE_DIR="$WORK_DIR/package"

cleanup() {
  rm -rf "$WORK_DIR"
}

trap cleanup EXIT

if [ ! -d .next-build/standalone ] || [ ! -d .next-build/server ] || [ ! -d .next-build/static ]; then
  echo "Missing .next-build output. Run npm run build before packaging." >&2
  exit 1
fi

mkdir -p "$PACKAGE_DIR/.next-build"

cp -a package.json package-lock.json tsconfig.json next.config.ts prisma.config.ts "$PACKAGE_DIR/"
cp -a docker-compose.yml deploy prisma public scripts src "$PACKAGE_DIR/"
cp -a .next-build/standalone "$PACKAGE_DIR/.next-build/standalone"

rm -rf "$PACKAGE_DIR/.next-build/standalone/.next-build/server" "$PACKAGE_DIR/.next-build/standalone/.next-build/static"
cp -a .next-build/server "$PACKAGE_DIR/.next-build/standalone/.next-build/server"
cp -a .next-build/static "$PACKAGE_DIR/.next-build/standalone/.next-build/static"
cp -a public "$PACKAGE_DIR/.next-build/standalone/public"

find "$PACKAGE_DIR" -name ".env" -o -name ".env.*" | while read -r env_file; do
  rm -f "$env_file"
done

mkdir -p "$(dirname "$ARTIFACT_PATH")"
tar -C "$PACKAGE_DIR" -czf "$ARTIFACT_PATH" .

echo "Created artifact: $ARTIFACT_PATH"
