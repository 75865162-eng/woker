/**
 * Full Sellfox Open API pull runner (CLI, standalone worker process).
 *
 * Usage:
 *   node --import ./scripts/runtime/database-bootstrap.mjs node_modules/tsx/dist/cli.mjs \
 *     scripts/sellfox-full-pull.ts --organization-id=ID --workspace-id=default --actor-user-id=ID \
 *     [--days=30] [--resources=stores,listings,...] [--ad-types=sp,sb,sd] [--skip-done] [--dry-run]
 *
 * Each resource becomes one durable SellfoxSyncRun row and is executed inline by
 * processSellfoxSyncRun(), so the shared PG advisory lock keeps the global
 * 1 request / 1.2s upstream rate limit intact even when the web worker runs too.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSellfoxCredentialStatus } from "@/lib/sellfox/credential-store";
import { processSellfoxSyncRun } from "@/lib/sellfox/sync-service";
import { isSellfoxSyncResource, sellfoxDateAt, type SellfoxSyncResource } from "@/lib/sellfox/sync-contract";
import { canExecuteSellfoxSync } from "@/lib/sellfox/sync-authorization";

const defaultOrder: SellfoxSyncResource[] = [
  "stores", "listings", "inventory", "orders", "sales", "performance", "fba_shipments",
  "ads_report", "ads_campaign", "ads_ad_group", "ads_placement", "ads_targeting", "ads_search_term",
];
const dateRangeResources = new Set<SellfoxSyncResource>(["orders", "sales", "performance", "ads_report", "ads_campaign", "ads_ad_group", "ads_placement", "ads_targeting", "ads_search_term"]);

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const options = new Map<string, string>();
  const allowed = new Set(["organization-id", "workspace-id", "actor-user-id", "days", "resources", "ad-types"]);
  for (const arg of argv) {
    if (arg === "--dry-run" || arg === "--skip-done" || arg === "--help") { flags.add(arg.slice(2)); continue; }
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match || !allowed.has(match[1]) || options.has(match[1])) throw new Error(`参数无效或重复：${arg}`);
    options.set(match[1], match[2].trim());
  }
  return { flags, options };
}

function log(event: Record<string, unknown>) {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
}

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2));
  if (flags.has("help")) {
    console.log("sellfox-full-pull --organization-id=ID --workspace-id=ID --actor-user-id=ID [--days=30] [--resources=a,b] [--ad-types=sp] [--skip-done] [--dry-run]");
    return;
  }
  const organizationId = options.get("organization-id");
  const workspaceId = options.get("workspace-id") ?? "default";
  const userId = options.get("actor-user-id");
  if (!organizationId || !userId) throw new Error("必须显式指定 --organization-id 与 --actor-user-id。");

  const resources = (options.get("resources")?.split(",").map((value) => value.trim()).filter(Boolean) ?? defaultOrder) as string[];
  for (const resource of resources) if (!isSellfoxSyncResource(resource)) throw new Error(`未知数据域：${resource}`);
  // stores must run before any store-scoped resource.
  const ordered = [...new Set<SellfoxSyncResource>(["stores", ...resources as SellfoxSyncResource[]])];

  const days = Math.min(Math.max(Number(options.get("days") ?? 30) || 30, 1), 90);
  const endDate = sellfoxDateAt(new Date(), -1);
  const startDate = sellfoxDateAt(new Date(), -days);
  const adTypes = (options.get("ad-types") ?? "sp").split(",").map((value) => value.trim()).filter(Boolean);
  const scope = { organizationId, workspaceId };
  const credential = await getSellfoxCredentialStatus(scope);
  if (!credential.configured) throw new Error("服务端赛狐凭据未配置，先运行 sellfox-credentials-seed.ts。");
  if (!(await canExecuteSellfoxSync({ ...scope, userId }))) throw new Error("操作者没有赛狐同步权限。");

  log({ phase: "plan", organizationId, workspaceId, userId, resources: ordered, days, startDate, endDate, adTypes, credential: credential.source });

  const storeCount = await prisma.sellfoxStore.count({ where: scope });
  log({ phase: "stores-known", storeCount });

  for (const resource of ordered) {
    if (flags.has("dry-run")) { log({ phase: "skip", resource, reason: "dry-run" }); continue; }
    if (flags.has("skip-done")) {
      const done = await prisma.sellfoxSyncRun.findFirst({ where: { ...scope, resource, status: "done" }, select: { id: true } });
      if (done) { log({ phase: "skip", resource, reason: "already-done", runId: done.id }); continue; }
    }
    const active = await prisma.sellfoxSyncRun.findFirst({ where: { ...scope, resource, status: { in: ["queued", "running"] } }, select: { id: true } });
    if (active) { log({ phase: "skip", resource, reason: "active-run", runId: active.id }); continue; }

    const summary: Record<string, unknown> = { trigger: "cli_full_pull", shopExternalIds: [] };
    if (dateRangeResources.has(resource)) { summary.startDate = startDate; summary.endDate = endDate; }
    if (resource.startsWith("ads_")) summary.adTypes = adTypes;
    const runId = `sellfox-sync-${randomUUID()}`;
    await prisma.sellfoxSyncRun.create({ data: { id: runId, organizationId, workspaceId, userId, resource, status: "queued", summary: summary as Prisma.InputJsonValue } });
    const startedAt = Date.now();
    log({ phase: "run-start", resource, runId });
    try {
      await processSellfoxSyncRun(runId);
      const run = await prisma.sellfoxSyncRun.findUnique({ where: { id: runId }, select: { status: true, error: true, summary: true } });
      const result = (run?.summary as { result?: unknown } | null)?.result;
      log({ phase: "run-end", resource, runId, status: run?.status, error: run?.error ?? null, seconds: Math.round((Date.now() - startedAt) / 1000), result });
    } catch (error) {
      const run = await prisma.sellfoxSyncRun.findUnique({ where: { id: runId }, select: { status: true, error: true } });
      log({ phase: "run-end", resource, runId, status: run?.status ?? "failed", error: run?.error ?? (error instanceof Error ? error.message : "未知错误"), seconds: Math.round((Date.now() - startedAt) / 1000) });
    }
  }
  log({ phase: "complete", organizationId, workspaceId });
}

main().catch((error) => {
  log({ phase: "fatal", error: error instanceof Error ? error.message : "未知错误" });
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
