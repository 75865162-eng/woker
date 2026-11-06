import { createHash, randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import type { SyncScope } from "@/lib/amazon-sync/policy";
import { AdsQueryError } from "./query-contract";
import { assertIsolatedReportEnvironment, type IsolatedReportTransport } from "./report-acquisition";
import { runIsolatedReportDispatch, tickIsolatedReports, type ReportDispatch } from "./report-runtime";

type WorkerEvent = "queue_error" | "worker_error" | "dispatch_failed" | "scan_failed";
type TickResult = { outcome: "scanned" | "busy" | "capacity" | "stopping"; enqueued: number; enqueueFailures: number; rowFailures: number; blocked: number };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function isolatedReportQueueName(scope: SyncScope) {
  return `ads-report-isolated-${digest([scope.organizationId, scope.workspaceId]).slice(0, 32)}`;
}
export function reportDispatchJobId(job: ReportDispatch) {
  return `report-${digest([job.taskId, job.dispatchVersion])}`;
}
function validDispatch(value: unknown): value is ReportDispatch {
  if (!value || typeof value !== "object") return false;
  const job = value as ReportDispatch;
  return typeof job.taskId === "string" && job.taskId.length > 0 && job.taskId.length <= 200
    && Number.isSafeInteger(job.dispatchVersion) && job.dispatchVersion > 0;
}

/** Explicit opt-in only. Importing this module starts no timer, queue or network call. */
export async function startIsolatedReportWorker(input: {
  scope: SyncScope;
  transport: IsolatedReportTransport;
  intervalMs?: number;
  onEvent?: (event: WorkerEvent) => void;
}) {
  assertIsolatedReportEnvironment(input.transport);
  const scope = Object.freeze({ organizationId: input.scope.organizationId, workspaceId: input.scope.workspaceId });
  if (Object.values(scope).some(value => typeof value !== "string" || !value || value.length > 200)) throw new AdsQueryError("ADS_REPORT_WORKER_SCOPE_INVALID");
  const redis = new URL(process.env.REDIS_URL ?? "http://fixture.invalid");
  if (process.env.AMAZON_SYNC_TEST_REDIS_DISPOSABLE !== "1" || redis.protocol !== "redis:" || redis.hostname !== "127.0.0.1" || !redis.port || redis.username || redis.password) throw new AdsQueryError("ADS_REPORT_WORKER_DISPOSABLE_REDIS_REQUIRED", 403);
  const intervalMs = input.intervalMs ?? 30000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 100 || intervalMs > 60000) throw new AdsQueryError("ADS_REPORT_WORKER_INTERVAL_INVALID");
  const name = isolatedReportQueueName(scope);
  const connection = { url: redis.toString(), maxRetriesPerRequest: null };
  const queue = new Queue<ReportDispatch>(name, { connection });
  const report = (event: WorkerEvent) => { try { input.onEvent?.(event); } catch { /* Diagnostics cannot stop recovery. */ } };
  queue.on("error", () => report("queue_error"));
  const worker = new Worker<ReportDispatch>(name, async job => {
    if (job.name !== "report-step" || !validDispatch(job.data)) throw new AdsQueryError("ADS_REPORT_DISPATCH_INVALID");
    await runIsolatedReportDispatch(scope, job.data, input.transport);
  }, { connection, concurrency: 2, autorun: false });
  worker.on("error", () => report("worker_error"));
  worker.on("failed", () => report("dispatch_failed"));
  let stopping = false;
  let inFlight: Promise<TickResult> | undefined;
  let closing: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function scan(): Promise<TickResult> {
    const empty = { enqueued: 0, enqueueFailures: 0, rowFailures: 0, blocked: 0 };
    if (stopping) return { outcome: "stopping", ...empty };
    const client = await queue.client;
    const lockKey = queue.toKey("report-scan-lock"), owner = randomUUID();
    client.defineCommand("adsReportScanAcquireV1", { numberOfKeys: 1, lua: "return redis.call('set', KEYS[1], ARGV[1], 'PX', 30000, 'NX')" });
    client.defineCommand("adsReportScanReleaseV1", { numberOfKeys: 1, lua: "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end" });
    if (await client.runCommand("adsReportScanAcquireV1", [lockKey, owner]) !== "OK") return { outcome: "busy", ...empty };
    try {
      const counts = await queue.getJobCounts("wait", "active", "delayed", "prioritized", "paused");
      let available = Math.max(0, 100 - Object.values(counts).reduce((sum, count) => sum + count, 0));
      if (!available) return { outcome: "capacity", ...empty };
      const result = await tickIsolatedReports(scope, async job => {
        // Expired scan locks cannot admit further jobs; another process may own it.
        if (stopping || available <= 0 || await client.get(lockKey) !== owner) throw new AdsQueryError("ADS_REPORT_QUEUE_ADMISSION_DEFERRED");
        await queue.add("report-step", job, {
          jobId: reportDispatchJobId(job), attempts: 1, removeOnComplete: true, removeOnFail: true,
        });
        available--;
      });
      if (result.rowFailures) report("scan_failed");
      return { outcome: "scanned", ...result };
    } finally {
      await client.runCommand("adsReportScanReleaseV1", [lockKey, owner]);
    }
  }
  function tick(): Promise<TickResult> {
    if (stopping) return Promise.resolve({ outcome: "stopping", enqueued: 0, enqueueFailures: 0, rowFailures: 0, blocked: 0 });
    if (inFlight) return inFlight;
    inFlight = scan().finally(() => { inFlight = undefined; });
    return inFlight;
  }
  function close(): Promise<void> {
    if (closing) return closing;
    stopping = true;
    if (timer) clearInterval(timer);
    closing = (async () => {
      await inFlight?.catch(() => undefined);
      try { await worker.close(); } finally { await queue.close(); }
    })();
    return closing;
  }
  try {
    // All instances for this scope share a two-operation queue-wide ceiling.
    await queue.setGlobalConcurrency(2);
    await worker.waitUntilReady();
    void worker.run().catch(() => report("worker_error"));
    timer = setInterval(() => { void tick().catch(() => report("scan_failed")); }, intervalMs);
    timer.unref();
    await tick();
    return { queueName: name, tick, close };
  } catch (error) {
    await close();
    throw error;
  }
}
