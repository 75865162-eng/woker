import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const script = readFileSync(new URL("../scripts/server-artifact-release.sh", import.meta.url), "utf8");
// Extract only these functions so the test cannot execute the release workflow.
const functions = ["read_previous_version", "next_version_label"].map((name) => {
  const match = script.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "m"));
  assert.ok(match, `Missing release function: ${name}`);
  return match[0];
}).join("\n");

function checkVersion(t, state, release, expected) {
  const dir = mkdtempSync(path.join(tmpdir(), "release-version-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, "version state.json");
  const currentLink = path.join(dir, "current release");
  if (state === "unreadable") {
    // Reading a directory fails even when tests run as root.
    mkdirSync(stateFile);
  } else if (state !== undefined) {
    writeFileSync(stateFile, state);
  }
  if (release !== undefined) {
    const releaseDir = path.join(dir, "release");
    mkdirSync(releaseDir);
    writeFileSync(path.join(releaseDir, "RELEASE.json"), release);
    symlinkSync(releaseDir, currentLink);
  }
  const output = execFileSync("bash", ["-c", `${functions}
set -euo pipefail
VERSION_STATE_FILE="$1"
CURRENT_LINK="$2"
previous="$(read_previous_version)"
printf '%s\\n' "$previous"
next_version_label "$previous"
`, "release-version-test", stateFile, currentLink], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(output, `${expected[0]}\n${expected[1]}\n`);
}

test("pretty-printed state parses v0.0.1 and bumps to v0.0.2", (t) => {
  checkVersion(t, JSON.stringify({ appVersion: "v0.0.1" }, null, 2), undefined, ["v0.0.1", "v0.0.2"]);
});

test("compact state takes precedence over current release and preserves major/minor", (t) => {
  checkVersion(t, '{"appVersion":"v2.3.9"}', '{"appVersion":"v2.3.8"}', ["v2.3.9", "v2.3.10"]);
});

test("JSON whitespace around the version field is supported", (t) => {
  checkVersion(t, '{\n\t"appVersion" \t: \n "v0.0.9"\n}\n', undefined, ["v0.0.9", "v0.0.10"]);
});

for (const [name, state] of [
  ["missing", undefined],
  ["unreadable", "unreadable"],
  ["malformed", "{broken"],
  ["missing version", "{}"],
  ["non-string version", '{"appVersion":1}'],
  ["invalid version", '{"appVersion":"bad-value"}'],
  ["null", "null"],
]) {
  test(`${name} state falls back to pretty-printed current release`, (t) => {
    checkVersion(t, state, JSON.stringify({ appVersion: "v1.2.3" }, null, 2), ["v1.2.3", "v1.2.4"]);
  });
}

test("first release without metadata starts at v0.0.1", (t) => {
  checkVersion(t, undefined, undefined, ["", "v0.0.1"]);
});

test("unusable state and current release retain the existing v0.0.1 default", (t) => {
  checkVersion(t, "{broken", '{"appVersion":null}', ["", "v0.0.1"]);
});
