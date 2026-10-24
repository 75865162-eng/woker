import type { Prisma } from "@prisma/client";
import { roleCanPerformAction, defaultRolePermissionMap, type RolePermissionMap } from "@/lib/accounts/permissions";
import { normalizeRolePermissions, normalizeRolePermissionMap } from "@/lib/accounts/role-permissions-utils";
import { parseDailyMetricsFilters } from "./read-models";
import { inventorySnapshotStatus } from "./readiness";
import { readPpcDataset, suggestPpc, summarizePpc } from "./ppc-read";

export class OpsError extends Error {
  constructor(readonly code: string, message: string, readonly exitCode = 2) { super(message); }
}
export type OpsCommand = { command: string; options: Record<string, string>; json: boolean };
const commands = ["freshness", "inventory list", "inventory summary", "catalog list", "metrics daily", "sync runs", "ppc report-summary", "ppc suggest"];
const allowedOptions = ["workspace", "sku", "asin", "page", "from", "to", "resource", "status"];
export const opsHelp = `Internal ERP, local database reads only.\nops ${commands.join("\nops ")}\nOptions: --workspace ID --sku SKU --asin ASIN --page N --from YYYY-MM-DD --to YYYY-MM-DD --resource NAME --status STATUS --json`;
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
  if (Object.keys(options).some((key) => key !== "workspace" && !applicable[command].includes(key))) throw new OpsError("INVALID_ARGUMENT", "Option does not apply to this command.");
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
  const workspace = await db.workspaceScope.findUnique({ where: { organizationId_id: { organizationId, id: workspaceId } } });
  if (!member || !workspace) throw new OpsError("FORBIDDEN", "Active organization member and workspace required.", 3);
  const roles = await db.organizationRosterRole.findMany({ where: { organizationId }, select: { id: true, permissions: true } });
  let permissions: RolePermissionMap;
  if (roles.length) permissions = Object.fromEntries(roles.map((row) => [row.id, { ...defaultRolePermissionMap[row.id], ...normalizeRolePermissions(row.permissions) }]));
  else {
    const legacy = await db.organizationRolePermission.findUnique({ where: { organizationId } });
    permissions = normalizeRolePermissionMap(legacy?.permissions);
  }
  const modules = ["operations", ...(command.command.startsWith("ppc ") ? ["workspace", "agents"] : [])];
  if (modules.some((module) => !roleCanPerformAction(member.role, module, "view", permissions))) throw new OpsError("FORBIDDEN", "Missing module view permission.", 3);
}
export function unavailableDailyMetrics() {
  return { rows: [], source: "PPC WorkspaceDataset", sourceStatus: "NOT_SYNCED", sourceNote: "PPC 导入缺少可信的日粒度 SKU/ASIN 映射；上传日期不是报表日期。", missingFields: { sales: null, adSpend: null, tacos: null } };
}
export async function runOpsCommand(db: Prisma.TransactionClient, identity: OpsIdentity, input: OpsCommand, now = new Date()) {
  const { organizationId, workspaceId } = identity; const scope = { organizationId, workspaceId };
  const { command, options } = input; const page = Number(options.page ?? 1); const take = 50;
  const sku = options.sku ? { sellerSku: { contains: options.sku, mode: "insensitive" as const } } : {};
  const latest = (resource: string) => db.amazonSyncRun.findFirst({ where: { ...scope, resource, status: "SUCCEEDED" }, orderBy: [{ finishedAt: "desc" }, { id: "desc" }] });
  if (command === "metrics daily") return { ...unavailableDailyMetrics(), filters: parseDailyMetricsFilters(new URLSearchParams(options), now) };
  if (command === "sync runs") return { page, rows: await db.amazonSyncRun.findMany({ where: { ...scope, ...(options.resource ? { resource: options.resource } : {}), ...(options.status ? { status: options.status } : {}) }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take, skip: (page - 1) * take }) };
  if (command.startsWith("ppc ")) {
    const dataset = await readPpcDataset(db, identity);
    return command === "ppc suggest" ? suggestPpc(db, identity, dataset, now) : summarizePpc(dataset, now);
  }
  if (command === "freshness") {
    const rows = await Promise.all(["inventory", "catalog", "ads", "orders", "finance", "fulfillment"].map(async (resource) => {
      if (!["inventory", "catalog"].includes(resource)) return { resource, status: "BLOCKED", lastSuccessAt: null, note: resource === "ads" ? "Use ppc report-summary; daily mapping unavailable." : "Executor not implemented." };
      const run = await latest(resource);
      const status = resource === "inventory" ? inventorySnapshotStatus(run?.finishedAt ?? null, now) : !run?.finishedAt ? "NOT_SYNCED" : now.getTime() - run.finishedAt.getTime() > 48 * 3600000 ? "STALE" : "FRESH";
      return { resource, status, runId: run?.id ?? null, lastSuccessAt: run?.finishedAt ?? null };
    }));
    return { scope, generatedAt: now, rows };
  }
  const resource = command === "catalog list" ? "catalog" : "inventory";
  const run = await latest(resource);
  if (!run) return { rows: [], summary: null, status: "NOT_SYNCED", page };
  if (resource === "catalog") return { runId: run.id, page, rows: await db.amazonCatalogSnapshot.findMany({ where: { ...scope, sourceRunId: run.id, ...sku }, orderBy: [{ sellerSku: "asc" }, { id: "asc" }], take, skip: (page - 1) * take }) };
  const where = { ...scope, syncRunId: run.id, ...sku };
  if (command === "inventory summary") return { runId: run.id, status: inventorySnapshotStatus(run.finishedAt, now), summary: await db.amazonInventorySnapshot.aggregate({ where, _count: { _all: true }, _sum: { fulfillableQuantity: true, inboundWorkingQuantity: true, inboundShippedQuantity: true, inboundReceivingQuantity: true, reservedQuantity: true, unfulfillableQuantity: true, researchingQuantity: true } }) };
  return { runId: run.id, status: inventorySnapshotStatus(run.finishedAt, now), page, rows: await db.amazonInventorySnapshot.findMany({ where, orderBy: [{ sellerSku: "asc" }, { id: "asc" }], take, skip: (page - 1) * take }) };
}
export function formatOpsOutput(value: unknown, json: boolean) {
  if (json) return JSON.stringify(value);
  if (!value || typeof value !== "object") return String(value);
  return Object.entries(value).map(([key, item]) => `${key}: ${typeof item === "string" ? item : JSON.stringify(item, null, 2)}`).join("\n");
}
