#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_PATH="${ARTIFACT_PATH:-dist/amazon-ad-bulk-operation-release.tar.gz}"
WORK_DIR="$(mktemp -d)"
PACKAGE_DIR="$WORK_DIR/package"
SOURCE_COMMIT="${SOURCE_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
SOURCE_BRANCH="${SOURCE_BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)}"
RELEASE_LINT_STATUS="${RELEASE_LINT_STATUS:-unknown}"
RELEASE_TEST_STATUS="${RELEASE_TEST_STATUS:-unknown}"
RELEASE_BUILD_STATUS="${RELEASE_BUILD_STATUS:-passed}"

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
find "$PACKAGE_DIR/.next-build/standalone" -mindepth 1 -maxdepth 1 \
  ! -name "server.js" \
  ! -name ".next-build" \
  -exec rm -rf {} +
rm -rf \
  "$PACKAGE_DIR/.next-build/standalone/.next-build/server" \
  "$PACKAGE_DIR/.next-build/standalone/.next-build/static" \
  "$PACKAGE_DIR/.next-build/standalone/.next-build/cache" \
  "$PACKAGE_DIR/.next-build/standalone/.next-build/types" \
  "$PACKAGE_DIR/.next-build/standalone/.next-build/diagnostics"
copy_without_macos_metadata .next-build/server "$PACKAGE_DIR/.next-build/standalone/.next-build/server"
copy_without_macos_metadata .next-build/static "$PACKAGE_DIR/.next-build/standalone/.next-build/static"
rm -rf "$PACKAGE_DIR/.next-build/standalone/public"
copy_without_macos_metadata public "$PACKAGE_DIR/.next-build/standalone/public"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

cat > "$PACKAGE_DIR/RELEASE-METADATA.json" <<JSON
{
  "commit": "$(json_escape "$SOURCE_COMMIT")",
  "branch": "$(json_escape "$SOURCE_BRANCH")",
  "lint": "$(json_escape "$RELEASE_LINT_STATUS")",
  "tests": "$(json_escape "$RELEASE_TEST_STATUS")",
  "build": "$(json_escape "$RELEASE_BUILD_STATUS")"
}
JSON

find "$PACKAGE_DIR" \( -name ".env" -o -name ".env.*" \) -type f -delete
find "$PACKAGE_DIR" \( -name "._*" -o -name ".DS_Store" \) -type f -delete
find "$PACKAGE_DIR" \( -name "*.log" -o -name "*.tsbuildinfo" \) -type f -delete

mkdir -p "$(dirname "$ARTIFACT_PATH")"
COPYFILE_DISABLE=1 tar -C "$PACKAGE_DIR" --exclude='._*' -czf "$ARTIFACT_PATH" .

artifact_sha256="$(shasum -a 256 "$ARTIFACT_PATH" | awk '{print $1}')"
artifact_size="$(stat -f%z "$ARTIFACT_PATH" 2>/dev/null || stat -c%s "$ARTIFACT_PATH")"
manifest_path="$(dirname "$ARTIFACT_PATH")/release-manifest.json"
cat > "$manifest_path" <<JSON
{
  "commit": "$(json_escape "$SOURCE_COMMIT")",
  "branch": "$(json_escape "$SOURCE_BRANCH")",
  "build": "$(json_escape "$RELEASE_BUILD_STATUS")",
  "lint": "$(json_escape "$RELEASE_LINT_STATUS")",
  "tests": "$(json_escape "$RELEASE_TEST_STATUS")",
  "artifact": "$(basename "$ARTIFACT_PATH")",
  "artifactSha256": "$artifact_sha256",
  "artifactSize": $artifact_size,
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
JSON

echo "Created artifact: $ARTIFACT_PATH"
du -h "$ARTIFACT_PATH"
echo "Created manifest: $manifest_path"
