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

if command -v shasum >/dev/null 2>&1; then
  artifact_sha256="$(shasum -a 256 "$ARTIFACT_PATH" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  artifact_sha256="$(sha256sum "$ARTIFACT_PATH" | awk '{print $1}')"
else
  echo "Neither shasum nor sha256sum is available." >&2
  exit 1
fi
artifact_size="$(stat -f%z "$ARTIFACT_PATH" 2>/dev/null || stat -c%s "$ARTIFACT_PATH")"
manifest_sha256="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.artifactSha256 || "")' "$MANIFEST_PATH")"
manifest_commit="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.commit || "")' "$MANIFEST_PATH")"
manifest_statuses="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write([data.build,data.lint,data.tests].join(","))' "$MANIFEST_PATH")"

if [ "$artifact_sha256" != "$manifest_sha256" ]; then
  echo "Artifact SHA256 does not match release manifest." >&2
  exit 1
fi

if [ "$EXPECTED_COMMIT" != "unknown" ] && [ "$manifest_commit" != "$EXPECTED_COMMIT" ]; then
  echo "Release commit does not match expected commit." >&2
  exit 1
fi

if [ "$manifest_statuses" != "passed,passed,passed" ]; then
  echo "Release manifest must report passed build, lint, and tests." >&2
  exit 1
fi

tar_listing="$(tar -tzf "$ARTIFACT_PATH" | sed 's#^\./##')"
required_paths=(
  ".next-build/standalone/server.js"
  ".next-build/standalone/.next-build/static/"
  ".next-build/standalone/public/"
  "prisma/migrations/"
  "RELEASE-METADATA.json"
  "deployment-plan.json"
  "src/lib/runtime/worker-registry.json"
  "deploy/production.env.example"
  "deploy/README.md"
  "deploy/systemd/amazon-web.service"
)
for required_path in "${required_paths[@]}"; do
  if ! grep -Fq "$required_path" <<< "$tar_listing"; then
    echo "Artifact is missing required path: $required_path" >&2
    exit 1
  fi
done

for forbidden_path in "node_modules/" ".git/" "coverage/" "tests/" ".next/" ".next-dev/" "dist/" "integration-evidence/"; do
  if grep -Fq "$forbidden_path" <<< "$tar_listing"; then
    echo "Artifact contains forbidden path: $forbidden_path" >&2
    exit 1
  fi
done

if grep -Eq '(^|/)[.]env($|[.])|^deploy/production[.]env$' <<< "$tar_listing"; then
  echo "Artifact contains a forbidden environment file." >&2
  exit 1
fi
registry_json="$(tar -xOzf "$ARTIFACT_PATH" ./src/lib/runtime/worker-registry.json)"
worker_paths="$(node -e 'const r=JSON.parse(process.argv[1]); if(!Array.isArray(r)||!r.length) throw Error("Empty registry"); for(const w of r) { if(!/^scripts\/[a-z0-9-]+[.]ts$/.test(w.entry)||!/^amazon-[a-z0-9-]+$/.test(w.service)) throw Error("Invalid registry"); console.log(w.entry); console.log(`deploy/systemd/${w.service}.service`); }' "$registry_json")"
while IFS= read -r worker_path; do
  if ! grep -Fxq "$worker_path" <<< "$tar_listing"; then
    echo "Artifact is missing registered worker asset: $worker_path" >&2
    exit 1
  fi
done <<< "$worker_paths"

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
