import type { Prisma } from "@prisma/client";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { readOrganizationRolePermissions } from "@/lib/accounts/role-catalog-server";
import { parseDailyMetricsFilters } from "./read-models";
import { inventorySnapshotStatus } from "./readiness";
import { readPpcDataset, suggestPpc, summarizePpc } from "./ppc-read";
import { amazonPublishedReadScope } from "./amazon-read-scope";
import { sellerAccessWhere } from "@/lib/amazon-sync/data-access";
import { amazonAccountReadAccess } from "@/lib/amazon-sync/read-account";
import { amazonBusinessData } from "@/lib/amazon-sync/business-data";

export class OpsError extends Error {
  constructor(readonly code: string, message: string, readonly exitCode = 2) { super(message); }
}
export type OpsCommand = { command: string; options: Record<string, string>; json: boolean };
const commands = ["freshness", "inventory list", "inventory summary", "catalog list", "metrics daily", "sync runs", "ppc report-summary", "ppc suggest"];
const allowedOptions = ["workspace", "seller-account", "marketplace", "sku", "asin", "page", "from", "to", "resource", "status"];
export const opsHelp = `Internal ERP, local database reads only.\nops ${commands.join("\nops ")}\nOptions: --workspace ID --seller-account ID --marketplace ID --sku SKU --asin ASIN --page N --from YYYY-MM-DD --to YYYY-MM-DD --resource NAME --status STATUS --json`;
export function parseOpsArgs(args: string[]): OpsCommand {
  const words: string[] = []; const options: Record<string, string> = {}; let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") { json = true; continue; }
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split(/=([\s\S]*)/);
      const value = inline ?? args[++i];
      if (!allowedOptions.includes(key) || !value || value.startsWith("--") || value.length > 200 || key in options) throw new OpsError("INVALID_ARGUMENT", `Invalid option: --${key}`);
      options[key] = value;
    } else words.push(arg);
  }
  const command = words.join(" ");
  if (!commands.includes(command)) throw new OpsError("INVALID_COMMAND", opsHelp);
  const applicable: Record<string, string[]> = {
    freshness: [], "inventory list": ["sku", "page"], "inventory summary": ["sku"], "catalog list": ["sku", "page"],
    "metrics daily": ["from", "to", "sku", "asin", "page"], "sync runs": ["resource", "status", "page"], "ppc report-summary": [], "ppc suggest": [],
  };
  if (Object.keys(options).some((key) => key !== "workspace" && !(!command.startsWith("ppc ") && ["seller-account", "marketplace"].includes(key)) && !applicable[command].includes(key))) throw new OpsError("INVALID_ARGUMENT", "Option does not apply to this command.");
  if (options.page && (!/^\d+$/.test(options.page) || +options.page < 1 || +options.page > 10000)) throw new OpsError("INVALID_ARGUMENT", "page must be 1–10000.");
  if (options.resource && !["readiness", "inventory", "catalog", "ads", "orders", "finance", "fulfillment"].includes(options.resource)) throw new OpsError("INVALID_ARGUMENT", "Unknown resource.");
  if (options.status && !["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "BLOCKED"].includes(options.status)) throw new OpsError("INVALID_ARGUMENT", "Unknown sync status.");
  if (command === "metrics daily" && (!parseDailyMetricsFilters(new URLSearchParams(options)) || (options.sku && options.asin))) throw new OpsError("INVALID_ARGUMENT", "Invalid date range (maximum 90 days) or conflicting sku/asin filters.");
  return { command, options, json };
}
export type OpsIdentity = { organizationId: string; workspaceId: string; actorUserId: string };
export function opsIdentity(command: OpsCommand, env: Record<string, string | undefined>): OpsIdentity {
  const organizationId = env.OPS_CLI_ORGANIZATION_ID?.trim(); const actorUserId = env.OPS_CLI_ACTOR_USER_ID?.trim();
  const allowed = env.OPS_CLI_WORKSPACE_IDS?.split(",").map((id) => id.trim()).filter(Boolean) ?? [];
  const workspaceId = command.options.workspace ?? allowed[0];
  if (!organizationId || !actorUserId || !workspaceId || !allowed.includes(workspaceId)) throw new OpsError("UNAUTHORIZED", "Configure OPS_CLI_ORGANIZATION_ID, OPS_CLI_ACTOR_USER_ID and OPS_CLI_WORKSPACE_IDS on the server.", 3);
  return { organizationId, actorUserId, workspaceId };
}
// Called inside a PostgreSQL READ ONLY transaction. No role seeding, sessions or Amazon requests.
export async function authorizeOps(db: Prisma.TransactionClient, identity: OpsIdentity, command: OpsCommand) {
  const { organizationId, workspaceId, actorUserId } = identity;
  const member = await db.organizationMember.findFirst({ where: { organizationId, userId: actorUserId, user: { status: "active" } } });
  const workspace = await assertWorkspaceAccess(organizationId, workspaceId, actorUserId, db);
  if (!member || !workspace) throw new OpsError("FORBIDDEN", "Active organization member and workspace required.", 3);
  if (!command.command.startsWith("ppc ")) return;
  const permissions = await readOrganizationRolePermissions(db, organizationId);
  const modules = ["operations", ...(command.command.startsWith("ppc ") ? ["workspace", "agents"] : [])];
  if (modules.some((module) => !roleCanPerformAction(member.role, module, "view", permissions))) throw new OpsError("FORBIDDEN", "Missing module view permission.", 3);
}
export function unavailableDailyMetrics() {
  return { rows: [], source: "PPC WorkspaceDataset", sourceStatus: "NOT_SYNCED", sourceNote: "PPC 导入缺少可信的日粒度 SKU/ASIN 映射；上传日期不是报表日期。", missingFields: { sales: null, adSpend: null, tacos: null } };
}
export async function runOpsCommand(db: Prisma.TransactionClient, identity: OpsIdentity, input: OpsCommand, now = new Date()) {
  const result = await readOpsCommand(db, identity, input, now);
  return input.command.startsWith("ppc ") ? result : amazonBusinessData(JSON.parse(JSON.stringify(result, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value)));
}
export async function assertOpsReadAccess(db: Prisma.TransactionClient, identity: OpsIdentity, input: OpsCommand) {
  await authorizeOps(db, identity, input);
  if (input.command.startsWith("ppc ")) return;
  return amazonAccountReadAccess(identity, identity.actorUserId, new URLSearchParams({
    ...(input.options["seller-account"] ? { sellerAccountId: input.options["seller-account"] } : {}),
    ...(input.options.marketplace ? { marketplaceId: input.options.marketplace } : {}),
  }), db);
}
async function readOpsCommand(db: Prisma.TransactionClient, identity: OpsIdentity, input: OpsCommand, now: Date) {
  const { organizationId, workspaceId } = identity; const scope = { organizationId, workspaceId };
  const { command, options } = input; const page = Number(options.page ?? 1); const take = 50;
  const access = await assertOpsReadAccess(db, identity, input);
  const params = new URLSearchParams({ ...(access ? { sellerAccountId: access.sellerIds[0] } : {}), ...(options.marketplace ? { marketplaceId: options.marketplace } : {}) });
  const sku = options.sku ? { sellerSku: { contains: options.sku, mode: "insensitive" as const } } : {};
  if (command === "metrics daily") return { ...unavailableDailyMetrics(), filters: parseDailyMetricsFilters(new URLSearchParams(options), now) };
  if (command === "sync runs") {
    const allowed = sellerAccessWhere(access!);
    return { page, rows: await db.amazonSyncRun.findMany({ where: { ...scope, executionVersion: 2, source: { ...scope, ...allowed, ...(options.marketplace ? { marketplaceId: options.marketplace } : {}), seller: { status: "active" } }, ...(options.resource ? { resource: options.resource } : {}), ...(options.status ? { status: options.status } : {}) }, select: { id: true, sourceId: true, resource: true, status: true, startedAt: true, finishedAt: true, processedCount: true }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take, skip: (page - 1) * take }) };
  }
  if (command.startsWith("ppc ")) {
    const dataset = await readPpcDataset(db, identity);
    return command === "ppc suggest" ? suggestPpc(db, identity, dataset, now) : summarizePpc(dataset, now);
  }
  const heads = await amazonPublishedReadScope(db, scope, identity.actorUserId, params, ["inventory", "catalog", "orders", "finance", "fulfillment"]);
  const latest = (resource: string) => db.amazonSyncRun.findFirst({ where: { ...scope, resource, status: "SUCCEEDED", executionVersion: 2, OR: heads.filter(h => h.resource === resource).map(h => ({ id: h.activeRunId!, sourceId: h.id })) }, orderBy: [{ finishedAt: "asc" }, { id: "asc" }] });
  if (command === "freshness") {
    const rows = await Promise.all(["inventory", "catalog", "ads", "orders", "finance", "fulfillment"].map(async (resource) => {
      if (resource === "ads") return { resource, status: "NOT_SYNCED", lastSuccessAt: null, note: "Ads 报表使用 PPC/Ads 报表专用查询口径；此命令不将其映射为日粒度 freshness。" };
      if (!["inventory", "catalog", "orders", "finance", "fulfillment"].includes(resource)) return { resource, status: "NOT_SYNCED", lastSuccessAt: null, note: "该数据域未开放同步。" };
      const resourceHeads = heads.filter(head => head.resource === resource);
      if (!resourceHeads.length) return { resource, status: "NOT_SYNCED", lastSuccessAt: null, note: "当前用户授权范围内没有已发布的数据源。" };
      const publishedRuns = resourceHeads.map(head => ({ id: head.activeRunId!, sourceId: head.id }));
      const [successes, attempts] = await Promise.all([
        db.amazonSyncRun.findMany({ where: { ...scope, resource, status: "SUCCEEDED", executionVersion: 2, finishedAt: { not: null }, OR: publishedRuns }, select: { id: true, sourceId: true, finishedAt: true }, orderBy: [{ finishedAt: "desc" }, { id: "desc" }], take: 200 }),
        db.amazonSyncRun.findMany({ where: { ...scope, resource, executionVersion: 2, OR: resourceHeads.map(head => ({ sourceId: head.id })) }, select: { id: true, sourceId: true, status: true, startedAt: true, error: true }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 200 }),
      ]);
      const successBySource = new Map(successes.map(run => [run.sourceId, run]));
      const latestSuccess = resourceHeads.map(head => successBySource.get(head.id)).filter((run): run is NonNullable<typeof run> => Boolean(run)).sort((a, b) => b.finishedAt!.getTime() - a.finishedAt!.getTime())[0];
      const latestAttempt = attempts[0];
      const failed = latestAttempt && ["FAILED", "BLOCKED"].includes(latestAttempt.status) && (!latestSuccess || latestAttempt.startedAt >= latestSuccess.finishedAt!);
      const status = !latestSuccess ? failed ? latestAttempt.status : "NOT_SYNCED" : failed ? latestAttempt.status : resource === "inventory" ? inventorySnapshotStatus(latestSuccess.finishedAt, now) : now.getTime() - latestSuccess.finishedAt!.getTime() > 48 * 3600000 ? "STALE" : "FRESH";
      return { resource, status, runId: latestSuccess?.id ?? null, lastSuccessAt: latestSuccess?.finishedAt ?? null, lastAttemptAt: latestAttempt?.startedAt ?? null, lastAttemptStatus: latestAttempt?.status ?? null, note: failed ? latestAttempt.error ?? "最近一次同步失败。" : null };
    }));
    return { scope, generatedAt: now, rows };
  }
  const resource = command === "catalog list" ? "catalog" : "inventory";
  const run = await latest(resource);
  if (!run) return { rows: [], summary: null, status: "NOT_SYNCED", page };
  const pairs = heads.filter(h => h.resource === resource);
  if (resource === "catalog") return { runId: pairs.length === 1 ? run.id : null, page, rows: await db.amazonCatalogSnapshot.findMany({ where: { ...scope, OR: pairs.map(h => ({ sourceRunId: h.activeRunId!, sellerAccountId: h.sellerAccountId, marketplaceId: h.marketplaceId })), ...sku }, orderBy: [{ sellerSku: "asc" }, { id: "asc" }], take, skip: (page - 1) * take }) };
  const where = { ...scope, OR: pairs.map(h => ({ syncRunId: h.activeRunId!, sellerAccountId: h.sellerAccountId, marketplaceId: h.marketplaceId })), ...sku };
  if (command === "inventory summary") return { runId: pairs.length === 1 ? run.id : null, status: inventorySnapshotStatus(run.finishedAt, now), summary: await db.amazonInventorySnapshot.aggregate({ where, _count: { _all: true }, _sum: { fulfillableQuantity: true, inboundWorkingQuantity: true, inboundShippedQuantity: true, inboundReceivingQuantity: true, reservedQuantity: true, unfulfillableQuantity: true, researchingQuantity: true } }) };
  return { runId: pairs.length === 1 ? run.id : null, status: inventorySnapshotStatus(run.finishedAt, now), page, rows: await db.amazonInventorySnapshot.findMany({ where, orderBy: [{ sellerSku: "asc" }, { id: "asc" }], take, skip: (page - 1) * take }) };
}
export function formatOpsOutput(value: unknown, json: boolean) {
  if (json) return JSON.stringify(value);
  if (!value || typeof value !== "object") return String(value);
  return Object.entries(value).map(([key, item]) => `${key}: ${typeof item === "string" ? item : JSON.stringify(item, null, 2)}`).join("\n");
}
