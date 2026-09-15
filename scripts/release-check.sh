#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_PATH="${1:-dist/amazon-ad-bulk-operation-release.tar.gz}"
MANIFEST_PATH="${RELEASE_MANIFEST_PATH:-$(dirname "$ARTIFACT_PATH")/release-manifest.json}"
CHECK_PATH="${RELEASE_CHECK_PATH:-$(dirname "$ARTIFACT_PATH")/release-check.json}"
EXPECTED_COMMIT="${SOURCE_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"

if [ ! -f "$ARTIFACT_PATH" ]; then
  echo "Artifact not found: $ARTIFACT_PATH" >&2
  exit 1
fi

if [ ! -f "$MANIFEST_PATH" ]; then
  echo "Release manifest not found: $MANIFEST_PATH" >&2
  exit 1
fi

artifact_sha256="$(shasum -a 256 "$ARTIFACT_PATH" | awk '{print $1}')"
artifact_size="$(stat -f%z "$ARTIFACT_PATH" 2>/dev/null || stat -c%s "$ARTIFACT_PATH")"
manifest_sha256="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.artifactSha256 || "")' "$MANIFEST_PATH")"
manifest_commit="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.commit || "")' "$MANIFEST_PATH")"

if [ "$artifact_sha256" != "$manifest_sha256" ]; then
  echo "Artifact SHA256 does not match release manifest." >&2
  exit 1
fi

if [ "$EXPECTED_COMMIT" != "unknown" ] && [ "$manifest_commit" != "$EXPECTED_COMMIT" ]; then
  echo "Release commit does not match expected commit." >&2
  exit 1
fi

tar_listing="$(tar -tzf "$ARTIFACT_PATH" | sed 's#^\./##')"
required_paths=(
  ".next-build/standalone/server.js"
  ".next-build/standalone/.next-build/static/"
  ".next-build/standalone/public/"
  "prisma/migrations/"
  "RELEASE-METADATA.json"
)
for required_path in "${required_paths[@]}"; do
  if ! grep -Fq "$required_path" <<< "$tar_listing"; then
    echo "Artifact is missing required path: $required_path" >&2
    exit 1
  fi
done

for forbidden_path in "node_modules/" ".git/" "coverage/" "tests/" ".env" ".next/" ".next-dev/" "dist/"; do
  if grep -Fq "$forbidden_path" <<< "$tar_listing"; then
    echo "Artifact contains forbidden path: $forbidden_path" >&2
    exit 1
  fi
done

node - "$MANIFEST_PATH" "$CHECK_PATH" "$artifact_sha256" "$artifact_size" "$EXPECTED_COMMIT" <<'NODE'
const fs = require("fs");
const [manifestPath, checkPath, artifactSha256, artifactSize, expectedCommit] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const check = {
  commit: manifest.commit,
  expectedCommit,
  build: manifest.build,
  lint: manifest.lint,
  tests: manifest.tests,
  artifact: manifest.artifact,
  artifactSha256,
  artifactSize: Number(artifactSize),
  checks: {
    sha256: true,
    requiredPaths: true,
    forbiddenPaths: true,
  },
  status: "passed",
  timestamp: new Date().toISOString(),
};
fs.writeFileSync(checkPath, `${JSON.stringify(check, null, 2)}\n`);
NODE

echo "Release check passed: $CHECK_PATH"
