import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const planner = resolve("scripts/deployment-plan.mjs");

function generate(changes: Record<string, string | null>, invalidBase = false, baseline: Record<string, string> = {}) {
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
    const workers = [
      ["import", "amazon-worker", "scripts/import-worker.ts"],
      ["image-upscale", "amazon-image-upscale-worker", "scripts/image-upscale-worker.ts"],
      ["amazon-sync", "amazon-sync-worker", "scripts/amazon-sync-worker.ts"],
      ["sellfox-sync", "amazon-sellfox-sync-worker", "scripts/sellfox-sync-worker.ts"],
    ];
    put("src/lib/runtime/worker-registry.json", JSON.stringify(workers.map(([id, service, entry]) => ({ id, service, entry }))));
    put("scripts/runtime/worker-manager.mjs", "");
    put("scripts/runtime/worker-child.mjs", "");
    put("src/lib/shared.ts", "export const shared = 1;");
    for (const [id, , entry] of workers) {
      put(entry, `import '@/lib/${id}/processor'; import '@/lib/shared';`);
      put(`src/lib/${id}/processor.ts`, `export const processor = '${id}';`);
    }
    for (const [file, data] of Object.entries(baseline)) put(file, data);
    git("add", ".");
    git("commit", "-qm", "baseline");
    const base = git("rev-parse", "HEAD");
    for (const [path, data] of Object.entries(changes)) {
      if (data === null) rmSync(join(dir, path)); else put(path, data);
    }
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
  for (const key of ["requiresBuild", "requiresDeploy", "requiresMigration", "requiresWorkerRestart", "requiresWebRestart", "requiresSellfoxSyncWorkerRestart", "requiresCaddyReload"]) assert.equal(plan[key], false, key);
});

test("web-only releases leave unrelated Workers running", () => {
  const plan = generate({ "src/components/example.tsx": "component" });
  assert.equal(plan.requiresWebRestart, true);
  assert.equal(plan.workerChanged, false);
  for (const key of ["requiresWorkerRestart", "requiresImageWorkerRestart", "requiresAmazonSyncWorkerRestart", "requiresSellfoxSyncWorkerRestart"]) assert.equal(plan[key], false, key);
  for (const key of ["requiresMigration", "requiresPrismaGenerate", "requiresRuntimeConfig", "requiresCaddyReload", "requiresInfraUpdate"]) assert.equal(plan[key], false, key);
});

test("shared libraries restart all actual consumers", () => {
  const plan = generate({ "src/lib/shared.ts": "shared" });
  assert.equal(plan.requiresWorkerRestart, true);
  assert.equal(plan.requiresImageWorkerRestart, true);
  assert.equal(plan.requiresSellfoxSyncWorkerRestart, true);
  assert.equal(plan.requiresMigration, false);
});

test("each Worker entry restarts only its registered service", () => {
  const keys = ["requiresWorkerRestart", "requiresImageWorkerRestart", "requiresAmazonSyncWorkerRestart", "requiresSellfoxSyncWorkerRestart"];
  for (const [index, file] of ["scripts/import-worker.ts", "scripts/image-upscale-worker.ts", "scripts/amazon-sync-worker.ts", "scripts/sellfox-sync-worker.ts"].entries()) {
    const plan = generate({ [file]: "worker" });
    for (const [other, key] of keys.entries()) assert.equal(plan[key], index === other, key);
    assert.equal(plan.requiresMigration, false);
  }
});

test("SP-API transitive dependencies and CHECK migrations do not restart unrelated Workers", () => {
  const plan = generate({ "src/lib/amazon-sync/parser.ts": "updated", "prisma/migrations/fixture/migration.sql": "ALTER TABLE fixture ADD CHECK (true);" }, false, {
    "src/lib/amazon-sync/processor.ts": "export { parse } from './parser';",
    "src/lib/amazon-sync/parser.ts": "export const parse = 1;",
  });
  assert.equal(plan.requiresWebRestart, true);
  assert.equal(plan.requiresAmazonSyncWorkerRestart, true);
  assert.deepEqual(plan.workerRestartReasons["amazon-sync-worker"], ["src/lib/amazon-sync/parser.ts"]);
  for (const key of ["requiresWorkerRestart", "requiresImageWorkerRestart", "requiresSellfoxSyncWorkerRestart"]) assert.equal(plan[key], false, key);
  assert.equal(plan.requiresMigration, true);
  assert.equal(plan.requiresManualDeploymentReview, true);
});

test("deleted dependencies still restart their previous consumers", () => {
  const plan = generate({ "src/lib/amazon-sync/old.ts": null, "src/lib/amazon-sync/processor.ts": "export const current = 1;" }, false, {
    "src/lib/amazon-sync/processor.ts": "export { old } from './old';",
    "src/lib/amazon-sync/old.ts": "export const old = 1;",
  });
  assert.equal(plan.requiresAmazonSyncWorkerRestart, true);
  assert.ok(plan.workerRestartReasons["amazon-sync-worker"].includes("src/lib/amazon-sync/old.ts"));
  assert.equal(plan.requiresWorkerRestart, false);
});

test("runtime, dependency and compiler changes restart all Workers", () => {
  for (const file of ["scripts/runtime/environment.mjs", "package-lock.json", "tsconfig.json"]) {
    const plan = generate({ [file]: '{"changed":true}' });
    for (const key of ["requiresWorkerRestart", "requiresImageWorkerRestart", "requiresAmazonSyncWorkerRestart", "requiresSellfoxSyncWorkerRestart"]) assert.equal(plan[key], true, key);
  }
});

test("unresolved or dynamic imports retain conservative restart evidence", () => {
  for (const processor of ["import './missing';", "await import(selectedModule);", "import /* reviewed separately */ './hidden';"]) {
    const plan = generate({ "src/lib/new-source.ts": "changed" }, false, { "src/lib/amazon-sync/processor.ts": processor });
    assert.equal(plan.requiresAmazonSyncWorkerRestart, true);
    assert.ok(plan.workerRestartReasons["amazon-sync-worker"].includes("unresolved-worker-dependencies"));
    assert.equal(plan.requiresWorkerRestart, false);
  }
});

test("type-only imports do not pull SP-API policy into unrelated Workers", () => {
  const plan = generate({ "src/lib/amazon-sync/processor.ts": "export const processor = 2;" }, false, {
    "src/lib/import/processor.ts": "import type { Scope } from '../amazon-sync/processor';\nimport { type Scope as OtherScope } from '../amazon-sync/processor';\nexport type { Scope } from '../amazon-sync/processor';",
  });
  assert.equal(plan.requiresWorkerRestart, false);
  assert.equal(plan.requiresAmazonSyncWorkerRestart, true);
});

test("side-effect imports and cycles are included without recursive loops", () => {
  const plan = generate({ "src/lib/amazon-sync/side-effect.ts": "changed" }, false, {
    "src/lib/amazon-sync/processor.ts": "import './side-effect';",
    "src/lib/amazon-sync/side-effect.ts": "import './processor';",
  });
  assert.equal(plan.requiresAmazonSyncWorkerRestart, true);
  assert.equal(plan.requiresWorkerRestart, false);
});

test("an individual systemd unit restarts its own service", () => {
  const plan = generate({ "deploy/systemd/amazon-sync-worker.service": "unit" });
  assert.equal(plan.requiresAmazonSyncWorkerRestart, true);
  for (const key of ["requiresWorkerRestart", "requiresImageWorkerRestart", "requiresSellfoxSyncWorkerRestart"]) assert.equal(plan[key], false, key);
  assert.equal(plan.requiresRuntimeConfig, true);
  assert.equal(plan.requiresManualDeploymentReview, true);
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
  const bootstrap = generate({ "scripts/bootstrap-server.sh": "setup", "deploy/systemd/amazon-sellfox-sync-worker.service": "service" });
  assert.equal(bootstrap.requiresManualDeploymentReview, true);
  assert.equal(bootstrap.requiresRuntimeConfig, true);
  assert.equal(bootstrap.requiresSellfoxSyncWorkerRestart, true);
});
