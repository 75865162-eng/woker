import "./runtime/worker-bootstrap.mjs";
import { createHeartbeatWriter } from "@/lib/runtime/heartbeat-writer";
import { runtimeHeartbeatMetadata } from "@/lib/runtime/worker-diagnostics";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { refreshDueReplenishmentPlans } from "@/lib/operations/replenishment-service";

/**
 * Dedicated replenishment/forecast scheduler.
 *
 * Replenishment used to ride the Amazon sync tick, so a stalled sync also stalled
 * every forecast. This worker owns the schedule: it runs at startup, then every
 * FORECAST_INTERVAL_MINUTES (5..1440, default 30). Each policy keeps its own
 * nextCalculationAt, so re-running early is a no-op.
 */

const workerName = process.env.FORECAST_WORKER_NAME?.trim() || `forecast-scheduler-${process.pid}`;
const workerId = process.env.FORECAST_WORKER_ID?.trim() || `${workerName}-${process.pid}`;
const configured = Number(process.env.FORECAST_INTERVAL_MINUTES ?? 30);
const intervalMinutes = Number.isFinite(configured) ? Math.max(5, Math.min(1440, Math.floor(configured))) : 30;

const state = {
  lastRunAt: null as string | null,
  lastError: null as string | null,
  lastDurationMs: null as number | null,
  runs: 0,
  failures: 0,
  running: false,
};

async function persistHeartbeat(status: "online" | "stopping") {
  if (!process.env.DATABASE_URL) return;
  const metadata = {
    ...runtimeHeartbeatMetadata(),
    pid: process.pid,
    hostname: process.env.HOSTNAME,
    schedule: { intervalMinutes, lastRunAt: state.lastRunAt, lastError: state.lastError, lastDurationMs: state.lastDurationMs, runs: state.runs, failures: state.failures, running: state.running },
  } satisfies Prisma.InputJsonValue;
  await prisma.workerHeartbeat.upsert({
    where: { id: workerId },
    create: { id: workerId, workerName, queueName: "forecast-scheduler", status, concurrency: 1, lastSeenAt: new Date(), metadata },
    update: { status, concurrency: 1, lastSeenAt: new Date(), metadata },
  });
}

const writeHeartbeat = createHeartbeatWriter(persistHeartbeat);
const heartbeatTimer = setInterval(() => {
  void writeHeartbeat().catch(() => console.error("[forecast-worker] heartbeat failed"));
}, 30_000);

let stopping = false;

async function tick() {
  if (stopping || state.running) return;
  state.running = true;
  const started = Date.now();
  try {
    await refreshDueReplenishmentPlans(new Date());
    state.lastRunAt = new Date().toISOString();
    state.lastError = null;
    state.runs += 1;
    console.log(`[forecast-worker] cycle ok in ${Date.now() - started}ms`);
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : "unknown";
    state.failures += 1;
    console.error("[forecast-worker] cycle failed; next cycle will retry:", state.lastError);
  } finally {
    state.lastDurationMs = Date.now() - started;
    state.running = false;
    void writeHeartbeat().catch(() => undefined);
  }
}

const cycleTimer = setInterval(() => void tick(), intervalMinutes * 60_000);

async function shutdown() {
  stopping = true;
  clearInterval(cycleTimer);
  clearInterval(heartbeatTimer);
  await writeHeartbeat("stopping").catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

console.log(`[forecast-worker] starting; interval=${intervalMinutes}m, worker=${workerId}`);
void writeHeartbeat().catch(() => console.error("[forecast-worker] heartbeat unavailable; retrying"));
void tick();
