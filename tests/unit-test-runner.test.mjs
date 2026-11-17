import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("unit runner includes TypeScript and MJS tests without inheriting credentials", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "unit-runner-fixture-"));
  try {
    const tests = path.join(directory, "tests");
    mkdirSync(tests);
    writeFileSync(path.join(tests, "fixture.test.ts"), "import test from 'node:test'; test('tsx fixture', () => {});\n");
    writeFileSync(path.join(tests, "fixture.test.mjs"), "import assert from 'node:assert/strict'; import test from 'node:test'; test('preload isolates fixture environment', () => { assert.equal(process.env.AUTH_SECRET, 'isolated-unit-test-session-secret-at-least-32-characters'); assert.equal(process.env.DATABASE_URL, undefined); assert.equal(process.env.AMAZON_SP_API_REFRESH_TOKEN, undefined); });\n");
    mkdirSync(path.join(directory, "scripts/runtime"), { recursive: true });
    writeFileSync(path.join(directory, "scripts/runtime/test-environment.mjs"), "if (!process.env.AUTH_SECRET) process.env.AUTH_SECRET = 'isolated-unit-test-session-secret-at-least-32-characters';\n");
    const runner = readFileSync(path.join(root, "scripts/runtime/run-unit-tests.mjs"), "utf8");
    const fixtureRunner = runner
      .replace('path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")', JSON.stringify(directory))
      .replace('path.join(root, "node_modules", "tsx", "dist", "cli.mjs")', JSON.stringify(path.join(root, "node_modules/tsx/dist/cli.mjs")));
    const runnerPath = path.join(directory, "runner.mjs");
    writeFileSync(runnerPath, fixtureRunner);
    const result = spawnSync(process.execPath, [runnerPath], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: "postgresql://real-secret.invalid/prod", AMAZON_SP_API_REFRESH_TOKEN: "real-token" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /preload isolates fixture environment/);
    assert.match(result.stdout, /tsx fixture/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
