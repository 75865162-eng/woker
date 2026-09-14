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

copy_without_macos_metadata() {
  COPYFILE_DISABLE=1 cp -R "$1" "$2"
}

copy_without_macos_metadata package.json "$PACKAGE_DIR/"
copy_without_macos_metadata package-lock.json "$PACKAGE_DIR/"
copy_without_macos_metadata tsconfig.json "$PACKAGE_DIR/"
copy_without_macos_metadata next.config.ts "$PACKAGE_DIR/"
copy_without_macos_metadata prisma.config.ts "$PACKAGE_DIR/"
copy_without_macos_metadata docker-compose.yml "$PACKAGE_DIR/"
copy_without_macos_metadata deploy "$PACKAGE_DIR/"
copy_without_macos_metadata prisma "$PACKAGE_DIR/"
copy_without_macos_metadata public "$PACKAGE_DIR/"
copy_without_macos_metadata scripts "$PACKAGE_DIR/"
copy_without_macos_metadata src "$PACKAGE_DIR/"
copy_without_macos_metadata .next-build/standalone "$PACKAGE_DIR/.next-build/"

# Next output tracing can pick up local build artifacts that exist under the
# repository root. They are never needed by the standalone server and can
# otherwise include the previous release artifact itself.
rm -rf \
  "$PACKAGE_DIR/.next-build/standalone/.next-build/server" \
  "$PACKAGE_DIR/.next-build/standalone/.next-build/static" \
  "$PACKAGE_DIR/.next-build/standalone/dist" \
  "$PACKAGE_DIR/.next-build/standalone/.next" \
  "$PACKAGE_DIR/.next-build/standalone/.next-dev" \
  "$PACKAGE_DIR/.next-build/standalone/coverage" \
  "$PACKAGE_DIR/.next-build/standalone/playwright-report" \
  "$PACKAGE_DIR/.next-build/standalone/uploads"
copy_without_macos_metadata .next-build/server "$PACKAGE_DIR/.next-build/standalone/.next-build/server"
copy_without_macos_metadata .next-build/static "$PACKAGE_DIR/.next-build/standalone/.next-build/static"
rm -rf "$PACKAGE_DIR/.next-build/standalone/public"
copy_without_macos_metadata public "$PACKAGE_DIR/.next-build/standalone/public"

find "$PACKAGE_DIR" \( -name ".env" -o -name ".env.*" \) -type f -delete
find "$PACKAGE_DIR" \( -name "._*" -o -name ".DS_Store" \) -type f -delete
find "$PACKAGE_DIR" \( -name "*.log" -o -name "*.tsbuildinfo" \) -type f -delete

mkdir -p "$(dirname "$ARTIFACT_PATH")"
COPYFILE_DISABLE=1 tar -C "$PACKAGE_DIR" --exclude='._*' -czf "$ARTIFACT_PATH" .

echo "Created artifact: $ARTIFACT_PATH"
du -h "$ARTIFACT_PATH"
