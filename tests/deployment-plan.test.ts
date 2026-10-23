import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const planner = resolve("scripts/deployment-plan.mjs");

function generate(changes: Record<string, string>, invalidBase = false) {
  const dir = mkdtempSync(join(tmpdir(), "deployment-plan-test-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const put = (path: string, data: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), data);
  };
  try {
    git("init", "-q");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Deployment test");
    put("package-lock.json", "{}");
    git("add", ".");
    git("commit", "-qm", "baseline");
    const base = git("rev-parse", "HEAD");
    for (const [path, data] of Object.entries(changes)) put(path, data);
    git("add", ".");
    git("commit", "-qm", "change");
    execFileSync(process.execPath, [planner], {
      cwd: dir, env: { ...process.env, BASE_SHA: invalidBase ? "invalid-ref" : base, GITHUB_OUTPUT: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(readFileSync(join(dir, "dist/deployment-plan.json"), "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("documentation does not build, migrate or restart services", () => {
  const plan = generate({ "AGENTS.md": "policy" });
  for (const key of ["requiresBuild", "requiresDeploy", "requiresMigration", "requiresWorkerRestart", "requiresWebRestart", "requiresCaddyReload"]) assert.equal(plan[key], false, key);
});

test("UI-only release restarts web, not workers or database", () => {
  const plan = generate({ "src/components/example.tsx": "component" });
  assert.equal(plan.requiresWebRestart, true);
  for (const key of ["requiresWorkerRestart", "requiresImageWorkerRestart", "requiresMigration", "requiresPrismaGenerate", "requiresRuntimeConfig", "requiresCaddyReload", "requiresInfraUpdate"]) assert.equal(plan[key], false, key);
});

test("shared libraries conservatively restart both dependent workers", () => {
  const plan = generate({ "src/lib/example.ts": "shared" });
  assert.equal(plan.requiresWorkerRestart, true);
  assert.equal(plan.requiresImageWorkerRestart, true);
  assert.equal(plan.requiresMigration, false);
});

test("individual worker entry changes do not restart the other worker", () => {
  const plan = generate({ "scripts/image-upscale-worker.ts": "worker" });
  assert.equal(plan.requiresWorkerRestart, false);
  assert.equal(plan.requiresImageWorkerRestart, true);
  assert.equal(plan.requiresAmazonSyncWorkerRestart, false);
  const amazonPlan = generate({ "scripts/amazon-sync-worker.ts": "worker" });
  assert.equal(amazonPlan.requiresWorkerRestart, false);
  assert.equal(amazonPlan.requiresImageWorkerRestart, false);
  assert.equal(amazonPlan.requiresAmazonSyncWorkerRestart, true);
});

test("schema without migration and invalid base fail closed", () => {
  assert.throws(() => generate({ "prisma/schema.prisma": "model" }));
  assert.throws(() => generate({ "README.md": "docs" }, true));
});

test("migration requires explicit review and generation", () => {
  const plan = generate({ "prisma/migrations/20261021_example/migration.sql": "SELECT 1;" });
  assert.equal(plan.requiresMigration, true);
  assert.equal(plan.requiresPrismaGenerate, true);
  assert.equal(plan.requiresManualDeploymentReview, true);
});

test("lockfile triggers installation while package scripts alone do not", () => {
  const plan = generate({ "package-lock.json": '{"changed":true}' });
  assert.equal(plan.requiresInstall, true);
  assert.notEqual(plan.previousLockfileSha256, plan.lockfileSha256);
  const scripts = generate({ "package.json": '{"scripts":{}}' });
  assert.equal(scripts.requiresInstall, false);
  assert.equal(scripts.requiresPrismaGenerate, false);
});

test("Caddy and infra configuration operations require their own changes", () => {
  const plan = generate({ "deploy/caddy/Caddyfile": "config" });
  assert.equal(plan.requiresCaddyReload, true);
  assert.equal(plan.requiresInfraUpdate, false);
  assert.equal(plan.requiresRuntimeConfig, false);
  assert.equal(plan.requiresManualDeploymentReview, true);
  const infra = generate({ "docker-compose.yml": "services" });
  assert.equal(infra.requiresInfraUpdate, true);
  assert.equal(infra.requiresCaddyReload, false);
});
