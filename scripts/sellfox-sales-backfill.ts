import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { canExecuteSellfoxSync } from "@/lib/sellfox/sync-authorization";
import { defaultSellfoxBackfillStart, sellfoxSyncScopeLock } from "@/lib/sellfox/schedule-time";
import { sellfoxDateAt, isSellfoxDate } from "@/lib/sellfox/sync-contract";
import { planSellfoxSalesBackfill } from "@/lib/sellfox/backfill-plan";
import { recoverSellfoxQueueRun } from "@/lib/sellfox/queue-recovery";
import { getSellfoxSyncQueue } from "@/lib/queue/redis-queue";

let backfillQueue: ReturnType<typeof getSellfoxSyncQueue> | undefined;
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("sellfox-sales-backfill --organization-id=ID --workspace-id=ID --actor-user-id=ID [--start-date=YYYY-MM-DD] [--end-date=YYYY-MM-DD] [--chunk-days=7] [--apply]\n默认只盘点本地覆盖；--apply 将缺日分段加入现有赛狐队列。重复执行恢复同批 queued 任务，不重建历史任务、不自动启用计划。");
    return;
  }
  const allowed = new Set(["organization-id", "workspace-id", "actor-user-id", "start-date", "end-date", "chunk-days"]);
  const options = new Map<string, string>();
  for (const arg of args) {
    if (arg === "--apply") continue;
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match || !allowed.has(match[1]) || options.has(match[1])) throw new Error("参数无效或重复，请使用 --help。");
    options.set(match[1], match[2]);
  }
  const organizationId = options.get("organization-id"), workspaceId = options.get("workspace-id"), userId = options.get("actor-user-id");
  if (!organizationId || !workspaceId || !userId) throw new Error("必须显式指定组织、工作区和操作者。");
  const scope = { organizationId, workspaceId, userId };
  if (!(await canExecuteSellfoxSync(scope))) throw new Error("操作者或工作区没有有效赛狐同步权限。");
  const startDate = options.get("start-date") ?? defaultSellfoxBackfillStart();
  const endDate = options.get("end-date") ?? sellfoxDateAt(new Date(), -1);
  if (!isSellfoxDate(endDate) || endDate > sellfoxDateAt(new Date(), -1)) throw new Error("补数结束日期不得晚于昨日。");
  const chunkDays = Number(options.get("chunk-days") ?? 7);
  const stores = await prisma.sellfoxStore.findMany({ where: { organizationId, workspaceId }, select: { id: true, externalId: true } });
  const coverage = await prisma.sellfoxSalesDayCoverage.findMany({ where: { SellfoxStore: { organizationId, workspaceId }, reportDate: { gte: startDate, lte: endDate } }, select: { storeId: true, reportDate: true } });
  const shops = new Map(stores.map((store) => [store.id, store.externalId]));
  const units = planSellfoxSalesBackfill({ startDate, endDate, chunkDays, shopExternalIds: stores.map((store) => store.externalId), coverage: coverage.map((row) => ({ shopExternalId: shops.get(row.storeId)!, reportDate: row.reportDate })) });
  const batchKey = createHash("sha256").update(JSON.stringify([organizationId, workspaceId, startDate, endDate])).digest("hex");
  const missingDays = units.reduce((sum, unit) => sum + unit.days, 0);
  console.log(JSON.stringify({ mode: args.includes("--apply") ? "apply" : "dry-run", batchKey, startDate, endDate, stores: stores.length, missingStoreDays: missingDays, plannedRuns: units.length, minimumRequests: missingDays * 2, minimumHours: Number((missingDays * 2 * 1.2 / 3600).toFixed(2)) }));
  if (!args.includes("--apply")) return;
  if (process.env.QUEUE_DRIVER !== "redis" || !process.env.SELLFOX_CLIENT_ID || !process.env.SELLFOX_CLIENT_SECRET) throw new Error("需要现有Redis队列与服务端赛狐凭据。");
  const queue = backfillQueue = getSellfoxSyncQueue();
  // Fail before creating durable runs if Redis is unavailable.
  await Promise.race([queue.waitUntilReady(), new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("Redis连接超时，未创建补数任务。")), 5000); timer.unref(); })]);
  const runs = await prisma.$transaction(async (tx) => {
    const lockKey = sellfoxSyncScopeLock(organizationId, workspaceId, "sales");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const prior = await tx.sellfoxSyncRun.findMany({ where: { organizationId, workspaceId, resource: "sales", summary: { path: ["backfillBatchKey"], equals: batchKey } }, select: { id: true, status: true } });
    if (prior.length) return prior;
    const active = await tx.sellfoxSyncRun.findFirst({ where: { organizationId, workspaceId, resource: "sales", status: { in: ["queued", "running"] } } });
    if (active) throw new Error("销量域已有任务，等待完成后再提交回填。");
    const data = units.map((unit) => ({ id: `sellfox-sync-${randomUUID()}`, ...scope, resource: "sales", status: "queued", summary: { trigger: "manual_backfill", backfillBatchKey: batchKey, requestedStartDate: startDate, requestedEndDate: endDate, shopExternalIds: [unit.shopExternalId], startDate: unit.startDate, endDate: unit.endDate, datesFrozen: true, storesFrozen: true, requestVersion: 2 } as Prisma.InputJsonValue }));
    if (data.length) await tx.sellfoxSyncRun.createMany({ data });
    return data.map((run) => ({ id: run.id, status: run.status }));
  });
  let enqueued = 0;
  for (const run of runs) {
    if (run.status !== "queued") continue;
    await recoverSellfoxQueueRun(run.id, queue); enqueued++;
  }
  console.log(JSON.stringify({ batchKey, totalRuns: runs.length, recoveredOrEnqueued: enqueued, failedRuns: runs.filter((run) => run.status === "failed").length, note: "由专用Worker执行；使用相同参数可恢复queued入队。失败任务保留断点，不自动重建或重置重试次数。计划未更改。" }));
}

main().catch(() => {
  // Never surface database/Redis URLs or external response bodies.
  console.error("补数未完成，请检查参数、队列、权限和持久化任务状态。不要重复创建任务。");
  process.exitCode = 1;
}).finally(async () => {
  await backfillQueue?.close().catch(() => undefined);
  await prisma.$disconnect();
});
