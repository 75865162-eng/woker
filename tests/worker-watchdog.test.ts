import assert from "node:assert/strict";
import test from "node:test";
import {
  workerWatchdogDecisions,
  formatWatchdogSummary,
  DEFAULT_STALE_MS,
} from "../scripts/runtime/worker-watchdog-lib.mjs";

const registry = [
  { id: "import", service: "amazon-worker", heartbeatQueue: "import-jobs" },
  { id: "amazon-sync", service: "amazon-sync-worker", heartbeatQueue: "amazon-data-center-jobs" },
];
const NOW = 1_700_000_000_000;
const row = (queueName: string, ageMs: number, status = "online", version = "v2") => ({
  queueName, status, lastSeenAt: new Date(NOW - ageMs).toISOString(), metadata: { version, queueReady: true },
});

test("健康心跳不触发重启", () => {
  const decisions = workerWatchdogDecisions(registry, [row("import-jobs", 10_000), row("amazon-data-center-jobs", 20_000)], {
    now: NOW, expectedVersion: "v2",
  });
  assert.ok(decisions.every(d => d.reason === null && !d.shouldRestart));
  assert.match(formatWatchdogSummary(decisions), /心跳正常/);
});

test("完全没有心跳记录触发 NO_HEARTBEAT", () => {
  const decisions = workerWatchdogDecisions(registry, [row("import-jobs", 10_000)], { now: NOW, expectedVersion: "v2" });
  const sync = decisions.find(d => d.id === "amazon-sync")!;
  assert.equal(sync.reason, "NO_HEARTBEAT");
  assert.equal(sync.shouldRestart, true);
  assert.equal(sync.service, "amazon-sync-worker");
});

test("心跳过期触发 HEARTBEAT_STALE", () => {
  const decisions = workerWatchdogDecisions(registry, [row("amazon-data-center-jobs", DEFAULT_STALE_MS + 60_000)], {
    now: NOW, expectedVersion: "v2",
  });
  const sync = decisions.find(d => d.id === "amazon-sync")!;
  assert.equal(sync.reason, "HEARTBEAT_STALE");
  assert.equal(sync.shouldRestart, true);
});

test("心跳在线但版本陈旧触发 VERSION_STALE", () => {
  const decisions = workerWatchdogDecisions(registry, [row("import-jobs", 5_000, "online", "v1"), row("amazon-data-center-jobs", 5_000)], {
    now: NOW, expectedVersion: "v2",
  });
  const imp = decisions.find(d => d.id === "import")!;
  assert.equal(imp.reason, "VERSION_STALE");
  assert.equal(imp.shouldRestart, true);
});

test("冷却期内不重复重启", () => {
  const decisions = workerWatchdogDecisions(registry, [], {
    now: NOW, expectedVersion: "v2", minRestartIntervalMs: 180_000,
    lastRestartAt: { "amazon-sync": NOW - 30_000 },
  });
  const sync = decisions.find(d => d.id === "amazon-sync")!;
  assert.equal(sync.reason, "NO_HEARTBEAT");
  assert.equal(sync.coolingDown, true);
  assert.equal(sync.shouldRestart, false);
  const imp = decisions.find(d => d.id === "import")!;
  assert.equal(imp.shouldRestart, true);
});

test("status 非 online 的心跳不算有效", () => {
  const decisions = workerWatchdogDecisions(registry, [row("import-jobs", 5_000, "stopping")], {
    now: NOW, expectedVersion: "v2",
  });
  assert.equal(decisions.find(d => d.id === "import")!.reason, "HEARTBEAT_STALE");
});

test("未来时间戳超过 skew 容差不算有效", () => {
  const decisions = workerWatchdogDecisions(registry, [row("import-jobs", -60_000)], {
    now: NOW, expectedVersion: "v2",
  });
  assert.equal(decisions.find(d => d.id === "import")!.reason, "HEARTBEAT_STALE");
});
