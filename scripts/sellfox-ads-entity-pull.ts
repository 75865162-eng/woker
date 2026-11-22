/**
 * 阶段2：赛狐广告管理实体「全量拉回」编排脚本（走现有 run/队列/权限/租约链路）。
 *
 * Usage:
 *   node --import ./scripts/runtime/database-bootstrap.mjs node_modules/tsx/dist/cli.mjs \
 *     scripts/sellfox-ads-entity-pull.ts --organization-id=ID --workspace-id=default --actor-user-id=ID \
 *     --seed --pull --verify
 *
 * - --seed   注册白名单内全部已文档化域，并把 ads_ent_* 广告实体端点置为 enabled。
 * - --pull   对每个 enabled 的 ads_ent_* 端点建 run 并 processSellfoxSyncRun（游标分页全量拉回）。
 * - --verify 对账：逐端点输出 run 状态、SellfoxApiRecord 行数、覆盖店铺数。
 *
 * 只写 SellfoxApiRecord（通用采集器既有落表），不改 schema、不伪造字段、不与广告日报相加。
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSellfoxCredentialStatus } from "@/lib/sellfox/credential-store";
import { canExecuteSellfoxSync } from "@/lib/sellfox/sync-authorization";
import { seedSellfoxKnownEndpoints } from "@/lib/sellfox/known-endpoints";
import { processSellfoxSyncRun } from "@/lib/sellfox/sync-service";

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const options = new Map<string, string>();
  for (const arg of argv) {
    if (["--seed", "--pull", "--verify", "--help"].includes(arg)) { flags.add(arg.slice(2)); continue; }
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (!m) throw new Error(`参数无效：${arg}`);
    options.set(m[1], m[2].trim());
  }
  return { flags, options };
}
function log(o: unknown) { process.stdout.write(JSON.stringify(o) + "\n"); }

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2));
  if (flags.has("help")) {
    log({ usage: "sellfox-ads-entity-pull --organization-id=ID --workspace-id=default --actor-user-id=ID [--seed] [--pull] [--verify]" });
    return;
  }
  const organizationId = options.get("organization-id");
  const workspaceId = options.get("workspace-id") ?? "default";
  const userId = options.get("actor-user-id");
  if (!organizationId || !userId) throw new Error("必须显式指定 --organization-id 与 --actor-user-id。");
  const scope = { organizationId, workspaceId };
  const credential = await getSellfoxCredentialStatus(scope);
  if (!credential.configured) throw new Error("服务端赛狐凭据未配置。");
  if (!(await canExecuteSellfoxSync({ ...scope, userId }))) throw new Error("操作者没有赛狐同步权限。");

  if (flags.has("seed")) {
    const seeded = await seedSellfoxKnownEndpoints(scope);
    const ads = await prisma.sellfoxApiEndpoint.findMany({ where: { ...scope, code: { startsWith: "ads_ent_" } }, select: { id: true, code: true, enabled: true } });
    for (const ep of ads) {
      if (!ep.enabled) await prisma.sellfoxApiEndpoint.update({ where: { id: ep.id }, data: { enabled: true, cursorDate: null, lastPlannedAt: null } });
    }
    log({ phase: "seed", created: seeded.created.length, updated: seeded.updated.length, adsEntities: ads.length });
  }

  if (flags.has("pull")) {
    const endpoints = await prisma.sellfoxApiEndpoint.findMany({
      where: { ...scope, code: { startsWith: "ads_ent_" }, enabled: true },
      select: { code: true }, orderBy: { code: "asc" },
    });
    if (!endpoints.length) throw new Error("没有已启用的 ads_ent_* 端点；先运行 --seed。");
    const storeCount = await prisma.sellfoxStore.count({ where: scope });
    log({ phase: "pull-plan", endpoints: endpoints.length, storeCount });
    for (const ep of endpoints) {
      const resource = `endpoint:${ep.code}`;
      const active = await prisma.sellfoxSyncRun.findFirst({ where: { ...scope, resource, status: { in: ["queued", "running"] } }, select: { id: true } });
      if (active) { log({ phase: "pull-skip", code: ep.code, reason: "active-run", runId: active.id }); continue; }
      const runId = `sellfox-sync-${randomUUID()}`;
      const summary = { trigger: "cli_ads_entity_pull", endpointCode: ep.code, shopExternalIds: [] as string[] };
      await prisma.sellfoxSyncRun.create({ data: {
        id: runId, organizationId, workspaceId, userId, resource, status: "queued",
        summary: summary as Prisma.InputJsonValue,
      } });
      const startedAt = Date.now();
      log({ phase: "pull-start", code: ep.code, runId });
      try {
        await processSellfoxSyncRun(runId);
        const run = await prisma.sellfoxSyncRun.findUnique({ where: { id: runId }, select: { status: true, error: true, summary: true } });
        const result = (run?.summary as { result?: unknown } | null)?.result;
        log({ phase: "pull-end", code: ep.code, runId, status: run?.status, error: run?.error ?? null, seconds: Math.round((Date.now() - startedAt) / 1000), result });
      } catch (error) {
        const run = await prisma.sellfoxSyncRun.findUnique({ where: { id: runId }, select: { status: true, error: true } });
        log({ phase: "pull-end", code: ep.code, runId, status: run?.status ?? "failed", error: run?.error ?? (error instanceof Error ? error.message : "未知错误"), seconds: Math.round((Date.now() - startedAt) / 1000) });
      }
    }
  }

  if (flags.has("verify")) {
    const endpoints = await prisma.sellfoxApiEndpoint.findMany({
      where: { ...scope, code: { startsWith: "ads_ent_" } }, select: { code: true, enabled: true }, orderBy: { code: "asc" },
    });
    const counts = await prisma.sellfoxApiRecord.groupBy({
      by: ["endpointCode"], where: scope, _count: { _all: true },
    });
    const stores = await prisma.sellfoxStore.groupBy({ by: ["externalId"], where: scope, _count: { _all: true } });
    const rows: Array<Record<string, unknown>> = [];
    for (const ep of endpoints) {
      const lastRun = await prisma.sellfoxSyncRun.findFirst({
        where: { ...scope, resource: `endpoint:${ep.code}` }, orderBy: { startedAt: "desc" },
        select: { status: true, error: true, finishedAt: true },
      });
      const countRow = counts.find((c) => c.endpointCode === ep.code);
      rows.push({ code: ep.code, enabled: ep.enabled, rows: countRow?._count._all ?? 0,
        storesWithRows: await prisma.sellfoxApiRecord.groupBy({ by: ["storeId"], where: { ...scope, endpointCode: ep.code }, _count: { _all: true } }).then((g) => g.length),
        lastRun: lastRun ? { status: lastRun.status, error: lastRun.error ?? null } : null });
    }
    log({ phase: "verify", storeCount: stores.length, totalRows: rows.reduce((n, r) => n + Number(r.rows), 0), endpoints: rows });
  }
}

main().catch((error) => { log({ phase: "fatal", error: error instanceof Error ? error.message : String(error) }); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode ?? 0); });
