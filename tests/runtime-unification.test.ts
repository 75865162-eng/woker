import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { EventEmitter } from "node:events";
import { runtimeEnvironment } from "../scripts/runtime/environment.mjs";
import { supervise, registry, restartDelay } from "../scripts/runtime/worker-manager.mjs";
import { backupDatabase } from "../scripts/runtime/backup-postgres.mjs";
import { registeredWorkerHealth } from "../src/lib/runtime/worker-health";
import { recoverQueuedJobs } from "../src/lib/runtime/queued-recovery";
import { queueHealth } from "../src/lib/runtime/queue-health";
import { dispatchPersistedJob } from "../src/lib/runtime/dispatch-persisted-job";
import { watchParent } from "../scripts/runtime/parent-lifecycle.mjs";
import { createHeartbeatWriter } from "../src/lib/runtime/heartbeat-writer";
import { connectionIdentity, publicHeartbeatMetadata } from "../src/lib/runtime/connection-identity";
import { restoreNextEnvironment } from "../scripts/runtime/generated-types-cleanup.mjs";

const fixtureConfig = "DATABASE_URL=postgresql://fixture:password@127.0.0.1:5440/fixture\nREDIS_URL=redis://127.0.0.1:6381/4\nQUEUE_DRIVER=redis\nAUTH_SECRET=literal$dollar\n";
test("connection identity compares Redis target/index without disclosing credentials", () => {
  const env = { DATABASE_URL: "postgresql://user:secret@localhost:5432/fixture", REDIS_URL: "redis://localhost:6379/0", AUTH_SECRET: "fixture-secret", QUEUE_DRIVER: "redis" };
  const identity = connectionIdentity(env)!;
  assert.match(identity, /^[a-f0-9]{64}$/);
  assert.equal(connectionIdentity({ ...env, DATABASE_URL: "postgres://different:password@localhost/fixture", REDIS_URL: "redis://localhost" }), identity);
  assert.notEqual(connectionIdentity({ ...env, REDIS_URL: "redis://localhost/1" }), identity);
  assert.notEqual(connectionIdentity({ ...env, REDIS_URL: "redis://localhost:6380" }), identity);
  assert.equal(connectionIdentity({ ...env, AUTH_SECRET: undefined }), null);
  const rows = registeredWorkerHealth([{ queueName: "import-jobs", status: "online", lastSeenAt: new Date(), metadata: { connectionIdentity: "other", version: "new" } }], new Date(), "new", identity);
  assert.equal(rows[0].connectionMatches, false);
  assert.equal(rows[0].mismatchedConnections, 1);
  const legacy = registeredWorkerHealth([{ queueName: "import-jobs", status: "online", lastSeenAt: new Date() }], new Date(), "new", identity);
  assert.equal(legacy[0].connectionMatches, null);
  assert.deepEqual(publicHeartbeatMetadata({ connectionIdentity: identity, pid: 1 }), { pid: 1 });
});

test("connection comparison includes every online instance and preserves unknown states", () => {
  const now = new Date();
  const heartbeat = (identity?: string) => ({ queueName: "import-jobs", status: "online", lastSeenAt: now, metadata: { connectionIdentity: identity } });
  const health = (identities: Array<string | undefined>, expected: string | null = "current") =>
    registeredWorkerHealth(identities.map(heartbeat), now, "new", expected)[0];
  assert.equal(health(["current", "current"]).connectionMatches, true);
  assert.equal(health(["current", "other"]).connectionMatches, false);
  assert.equal(health(["current", "other"]).mismatchedConnections, 1);
  assert.equal(health(["current", undefined]).connectionMatches, null);
  assert.equal(health([]).connectionMatches, null);
  assert.equal(health(["current"], null).connectionMatches, null);
});

test("isolated Next cleanup restores only its own route reference and preserves concurrent edits", () => {
  const baseline = '/// <reference path="./.next-dev/types/routes.d.ts" />\n// baseline\n';
  const generated = '/// <reference path="./.next-dev-runtime-fixture/types/routes.d.ts" />\n// concurrent note\n';
  assert.equal(restoreNextEnvironment(generated, baseline, ".next-dev-runtime-fixture"), '/// <reference path="./.next-dev/types/routes.d.ts" />\n// concurrent note\n');
  assert.equal(restoreNextEnvironment(baseline, generated, ".next-dev-runtime-fixture"), baseline);
});
test("shutdown heartbeat waits for the in-flight online write and cannot be overwritten by later ticks", async () => {
  let finishOnline!: () => void;
  const onlineWrite = new Promise<void>(resolve => { finishOnline = resolve; });
  const persisted: string[] = [];
  const write = createHeartbeatWriter(async status => {
    if (status === "online") await onlineWrite;
    persisted.push(status);
  });
  const online = write();
  assert.equal(write(), online, "coalesce overlapping heartbeats");
  const stop = write("stopping");
  assert.equal(write(), stop); assert.equal(write("stopping"), stop);
  assert.deepEqual(persisted, []); finishOnline(); await stop;
  assert.deepEqual(persisted, ["online", "stopping"]);
  await write(); assert.deepEqual(persisted, ["online", "stopping"]);
});

test("database heartbeat failure permits retry and cannot suppress final stopping write", async () => {
  let attempts = 0;
  const persisted: string[] = [];
  const write = createHeartbeatWriter(async status => {
    if (status === "online" && ++attempts < 3) throw new Error("fixture database outage");
    persisted.push(status);
  });
  await assert.rejects(write(), /fixture database outage/);
  const failedOnline = write(); const stop = write("stopping");
  await assert.rejects(failedOnline, /fixture database outage/); await stop;
  assert.deepEqual(persisted, ["stopping"]);
  const retry = createHeartbeatWriter(async () => { if (++attempts === 3) throw new Error("temporary"); });
  await assert.rejects(retry()); await retry();
});
test("queue health remains bounded during Redis outages", async () => {
  assert.equal((await queueHealth(() => new Promise(() => {}), 5)).available, false);
  assert.equal((await queueHealth(async () => { throw new Error("offline"); })).available, false);
  assert.equal((await queueHealth(async () => ({ waiting: 2 }))).counts.waiting, 2);
});
function fixture(fn: (root: string) => void | Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), "erp-runtime-unit-"));
  writeFileSync(path.join(root, ".env"), fixtureConfig);
  return Promise.resolve().then(() => fn(root)).finally(() => rmSync(root, { recursive: true, force: true }));
}

test("local configuration is literal, unified, and rejects inherited conflicts without leaking values", () => fixture(root => {
  const env = runtimeEnvironment({ root, inherited: {} });
  assert.equal(env.AUTH_SECRET, "literal$dollar");
  assert.equal(env.__NEXT_PROCESSED_ENV, "true");
  assert.throws(() => runtimeEnvironment({ root, inherited: { DATABASE_URL: "postgresql://secret:do-not-print@host/prod" } }), error => {
    assert.match(String(error), /DATABASE_URL conflicts/); assert.ok(!String(error).includes("do-not-print")); return true;
  });
  assert.throws(() => runtimeEnvironment({ root, inherited: { DOTENV_CONFIG_PATH: ".env.amazon-live.local" } }), /Alternate dotenv/);
  writeFileSync(path.join(root, ".env.local"), "DATABASE_URL=other");
  assert.throws(() => runtimeEnvironment({ root, inherited: {} }), /Extra Next environment/);
  rmSync(path.join(root, ".env.local")); writeFileSync(path.join(root, ".env.amazon-live.local"), "DATABASE_URL=legacy");
  assert.equal(runtimeEnvironment({ root, inherited: {} }).DATABASE_URL, env.DATABASE_URL);
}));

test("local remote targets and inline mode are refused; production only reads injected configuration", () => fixture(root => {
  writeFileSync(path.join(root, ".env"), fixtureConfig.replace("127.0.0.1:5440", "production.invalid:5440"));
  assert.throws(() => runtimeEnvironment({ root, inherited: {} }), /remote databases are forbidden/);
  const prod = { ERP_RUNTIME_MODE: "production", DATABASE_URL: "postgresql://production.invalid/erp", REDIS_URL: "redis://redis.internal", QUEUE_DRIVER: "redis" };
  assert.equal(runtimeEnvironment({ root, inherited: prod }).DATABASE_URL, prod.DATABASE_URL);
  assert.throws(() => runtimeEnvironment({ root, inherited: { ...prod, QUEUE_DRIVER: "inline" } }), /QUEUE_DRIVER=redis/);
}));

test("registry covers existing capabilities; missing, stopping, expired and mismatched heartbeats remain visible", () => {
  const now = new Date("2026-11-06T10:00:00Z");
  // import, image-upscale, amazon-sync, sellfox-sync, forecast
  assert.equal(registry.length, 5);
  const rows = registeredWorkerHealth([
    { queueName: "sellfox-sync-jobs", status: "online", lastSeenAt: now, metadata: { version: "old", queueReady: false } },
    { queueName: "import-jobs", status: "stopping", lastSeenAt: now },
    { queueName: "image-upscale-jobs", status: "online", lastSeenAt: new Date(now.getTime() - 90_001) },
  ], now, "new");
  assert.equal(rows.find(r => r.id === "amazon-sync")?.lastSeenAt, null);
  assert.equal(rows.find(r => r.id === "import")?.online, false);
  assert.equal(rows.find(r => r.id === "image-upscale")?.online, false);
  assert.equal(rows.find(r => r.id === "sellfox-sync")?.online, true);
  assert.equal(rows.find(r => r.id === "sellfox-sync")?.queueReady, false);
  assert.equal(rows.find(r => r.id === "sellfox-sync")?.versionMatches, false);
});

test("manager starts registrations, retries failures with backoff and stops every child", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const children: Array<EventEmitter & { kill: (signal: string) => boolean }> = [];
  const launches: string[][] = [];
  const manager = supervise(registry, {
    // Injectable child implementation: never imports a real Worker or reads .env.
    launch: ((_command: string, args: string[]) => {
      const child = Object.assign(new EventEmitter(), { kill: (signal: string) => { child.emit("exit", 0, signal); return true; } });
      children.push(child); launches.push(args); return child;
    }) as typeof import("node:child_process").spawn,
    log: () => {},
  });
  manager.start();
  assert.equal(children.length, 5);
  assert.deepEqual(launches.map(args => args.at(-1)), registry.map((item: { id: string }) => item.id));
  children[0].emit("exit", 1);
  t.mock.timers.tick(1000);
  assert.equal(children.length, 6);
  await manager.stop();
  t.mock.timers.tick(60_000);
  assert.equal(children.length, 6);
  assert.equal(restartDelay(10), 30_000);
});

test("duplicate instance is fatal and does not enter an infinite restart loop", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const child = Object.assign(new EventEmitter(), { kill: () => true });
  let fatal = 0;
  const manager = supervise([registry[0]], { launch: (() => child) as unknown as typeof import("node:child_process").spawn, log: () => {}, onFatal: () => { fatal++; } });
  manager.start(); child.emit("exit", 73); t.mock.timers.tick(60_000);
  assert.equal(fatal, 1);
});

test("queued recovery rebuilds messages without modifying persisted running work; failures propagate for retry", async () => {
  const rows = [{ id: "a", status: "queued" }, { id: "b", status: "running" }];
  const messages: string[] = [];
  assert.equal(await recoverQueuedJobs(async () => rows.filter(r => r.status === "queued"), async id => { messages.push(id); }), 1);
  assert.deepEqual(messages, ["a"]); assert.equal(rows[1].status, "running");
  await assert.rejects(recoverQueuedJobs(async () => { throw new Error("database restarting"); }, async () => {}), /database restarting/);
});

test("dispatch failure and timeout preserve durable intent, including a late successful enqueue", async () => {
  assert.equal((await dispatchPersistedJob(async () => { throw new Error("redis offline"); })).dispatchDeferred, true);
  let finish: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  assert.equal((await dispatchPersistedJob(() => pending, 5)).dispatchDeferred, true);
  finish!(); await pending;
  assert.equal((await dispatchPersistedJob(async () => {})).dispatchDeferred, false);
});

test("manager death triggers child graceful stop and bounded force-stop; cleanup cancels escalation", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const channel = Object.assign(new EventEmitter(), { connected: true });
  const signals: string[] = [];
  const dispose = watchParent(channel as unknown as NodeJS.Process, { timeoutMs: 100, signal: value => { signals.push(value); } });
  channel.emit("disconnect"); channel.emit("disconnect");
  assert.deepEqual(signals, ["SIGTERM"]);
  t.mock.timers.tick(100); assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  dispose();
  const disposeAgain = watchParent(channel as unknown as NodeJS.Process, { timeoutMs: 100, signal: value => { signals.push(value); } });
  channel.emit("disconnect"); disposeAgain(); t.mock.timers.tick(100);
  assert.equal(signals.length, 3);
});

test("start and stop are idempotent, and an unresponsive child is force-stopped", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals: string[] = [];
  let launches = 0;
  const child = Object.assign(new EventEmitter(), { kill: (signal: string) => { signals.push(signal); if (signal === "SIGKILL") child.emit("exit", null, signal); return true; } });
  const manager = supervise([registry[0]], { launch: (() => { launches++; return child; }) as unknown as typeof import("node:child_process").spawn, log: () => {} });
  manager.start(); manager.start(); assert.equal(launches, 1);
  const first = manager.stop(100); const second = manager.stop(100);
  assert.equal(first, second); assert.deepEqual(signals, ["SIGTERM"]);
  t.mock.timers.tick(100); await first;
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("an older online process cannot hide behind a current-version heartbeat", () => {
  const now = new Date();
  const rows = registeredWorkerHealth([
    { queueName: "import-jobs", status: "online", lastSeenAt: now, metadata: { version: "new", queueReady: true } },
    { queueName: "import-jobs", status: "online", lastSeenAt: new Date(now.getTime() - 1000), metadata: { version: "old", queueReady: false } },
  ], now, "new");
  const worker = rows.find(row => row.id === "import")!;
  assert.equal(worker.instances, 2); assert.equal(worker.mismatchedInstances, 1);
  assert.equal(worker.versionMatches, false); assert.equal(worker.queueReady, false);
});

test("backup publishes only verified data, passes secrets via environment, and cleans partial failures", () => fixture(async root => {
  const directory = path.join(root, "backups");
  const env = { DATABASE_URL: "postgresql://fixture:fixture_password@127.0.0.1:5440/fixture", PATH: process.env.PATH };
  const calls: string[] = [];
  const result = await backupDatabase({ directory, env, run: async (command: string, args: string[], pgEnv: Record<string, string>) => {
    calls.push(command); assert.ok(!args.join(" ").includes("fixture_password"));
    assert.equal(pgEnv.PGPASSWORD, "fixture_password");
    if (command === "pg_dump") writeFileSync(args.at(-1)!, "fixture-custom-dump");
  } });
  assert.deepEqual(calls, ["pg_dump", "pg_restore"]);
  assert.ok(readFileSync(path.join(directory, result.filename + ".sha256"), "utf8").includes(result.checksum));
  await assert.rejects(backupDatabase({ directory, env, run: async () => { throw new Error("fixture failure"); } }));
  assert.equal(readdirSync(directory).some(name => name.endsWith(".partial") || name === ".backup.lock"), false);
}));
