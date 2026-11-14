/**
 * Sellfox MCP server runtime: credential lifecycle, authentication, scoped reads.
 *
 * Isolation rules enforced here:
 *  - only `sfmcp_` credentials (or the explicitly shared compatibility token)
 *    authenticate; Amazon `amcp_` credentials are rejected before lookup;
 *  - the organization / workspace / store fence comes from the credential row,
 *    never from the request body;
 *  - only Sellfox* tables in the registry allow-list are queried, through a
 *    read-only Postgres role;
 *  - every call is audited under `sellfox.mcp.*`, separate from `amazon.mcp.*`.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Pool } from "pg";
import { prisma } from "@/lib/db/prisma";
import {
  assertCredentialStores, assertCredentialTool, assertEndpointProvider, bearerToken,
  McpIsolationError, mcpAuditAction, providerOfToken,
} from "@/lib/mcp/isolation";
import {
  normalizeSellfoxToolGrants, sellfoxDataset, sellfoxDatasetKeys, sellfoxDatasets,
  sellfoxMcpDefinition, sellfoxMcpToolDefinitions, sellfoxMcpToolNames, type SellfoxMcpToolDefinition,
} from "./mcp-tool-registry";

export const SELLFOX_MCP_TOKEN_PREFIX = "sfmcp_";
export const MAX_MCP_LIMIT = 500;

export type SellfoxMcpScope = { organizationId: string; workspaceId: string };

export type SellfoxMcpCredential = {
  id: string; organizationId: string; workspaceId: string; userId: string; name: string;
  tokenPrefix: string; tools: string[]; storeIds: string[]; scopes: Prisma.JsonValue;
  status: string; revision: number; expiresAt: Date; lastUsedAt: Date | null;
};

export type SellfoxMcpIdentity = SellfoxMcpCredential & {
  kind: "credential" | "shared-env";
  /** Internal SellfoxStore ids, or `*` for the shared compatibility identity. */
  storeScope: string[];
};

const credentialSelect = {
  id: true, organizationId: true, workspaceId: true, userId: true, name: true, tokenPrefix: true,
  tools: true, storeIds: true, scopes: true, status: true, revision: true, expiresAt: true, lastUsedAt: true,
} satisfies Prisma.SellfoxMcpCredentialSelect;

export const sellfoxMcpTokenHash = (value: string) => createHash("sha256").update(value).digest("hex");

function sharedToken() {
  const token = process.env.MCP_HTTP_TOKEN?.trim() ?? "";
  if (!token || process.env.MCP_DISABLE_SHARED_TOKEN === "true") return null;
  return token;
}

async function audit(identity: SellfoxMcpIdentity | null, event: string, metadata: Prisma.InputJsonObject) {
  await prisma.auditLog.create({
    data: {
      organizationId: identity?.organizationId ?? null,
      userId: identity?.userId ?? null,
      action: mcpAuditAction("sellfox", event),
      entityType: "SellfoxMcpCredential",
      entityId: identity?.id ?? null,
      metadata: { workspaceId: identity?.workspaceId ?? null, provider: "sellfox", ...metadata },
    },
  });
}

export async function auditSellfoxMcpProtocol(identity: SellfoxMcpIdentity, method: string, requestId: string) {
  await audit(identity, "protocol", { credentialId: identity.id, requestId, method: ["initialize", "notifications/initialized", "ping", "tools/list"].includes(method) ? method : "UNKNOWN" });
}

export async function authenticateSellfoxMcp(authorization: string | null, resource = "/api/mcp/sellfox"): Promise<SellfoxMcpIdentity> {
  const token = bearerToken(authorization);
  const legacy = sharedToken();
  const isShared = Boolean(legacy && token && token.length === legacy.length && timingSafeEqual(Buffer.from(token), Buffer.from(legacy)));
  const provider = providerOfToken(token);
  if (!isShared) {
    try {
      assertEndpointProvider("sellfox", provider);
    } catch (error) {
      // Cross-provider attempts are audited even though no identity matched.
      await prisma.auditLog.create({
        data: {
          organizationId: null, userId: null, action: mcpAuditAction("sellfox", "isolation.denied"), entityType: "SellfoxMcpCredential",
          metadata: { provider: "sellfox", attemptedProvider: provider ?? "unknown", tokenPrefix: token?.slice(0, 8) ?? null, resource, reason: error instanceof McpIsolationError ? error.code : "UNKNOWN" },
        },
      }).catch(() => undefined);
      throw error;
    }
  }
  if (isShared) {
    const organizationId = process.env.MCP_ORG_ID?.trim() ?? "";
    if (!organizationId) throw new McpIsolationError("MCP_ORG_ID 未配置。", "PROVIDER_MISMATCH", 503, "sellfox");
    const stores = (process.env.MCP_STORE_IDS ?? "*").split(",").map(value => value.trim()).filter(Boolean);
    const now = new Date();
    const identity: SellfoxMcpIdentity = {
      kind: "shared-env", id: "sellfox-shared-env", organizationId, workspaceId: process.env.MCP_WORKSPACE_ID?.trim() || "default",
      userId: "sellfox-shared-env", name: "共享兼容令牌", tokenPrefix: token.slice(0, 8), tools: [...sellfoxMcpToolNames],
      storeIds: stores, scopes: [], status: "ACTIVE", revision: 0, expiresAt: new Date(now.getTime() + 3600_000), lastUsedAt: null,
      storeScope: stores.length ? stores : ["*"],
    };
    return identity;
  }
  const row = await prisma.sellfoxMcpCredential.findUnique({ where: { tokenHash: sellfoxMcpTokenHash(token!) }, select: credentialSelect });
  if (!row || row.status !== "ACTIVE" || row.expiresAt <= new Date()) {
    await audit(null, "authentication.denied", { requestId: randomUUID(), reason: row ? "CREDENTIAL_INACTIVE" : "INVALID_CREDENTIAL", resource });
    throw new McpIsolationError("认证失败。", "PROVIDER_MISMATCH", 401, "sellfox");
  }
  await prisma.sellfoxMcpCredential.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  const storeScope = row.storeIds.length ? row.storeIds : ["*"];
  return { ...row, kind: "credential", storeScope };
}

/* ------------------------------------------------------------------ */
/* credential lifecycle                                                */
/* ------------------------------------------------------------------ */

export async function listSellfoxMcpCredentials(scope: SellfoxMcpScope, actor: string) {
  return prisma.sellfoxMcpCredential.findMany({
    where: { ...scope, userId: actor }, select: credentialSelect, orderBy: { createdAt: "desc" }, take: 100,
  });
}

export type SellfoxMcpCommand = Record<string, unknown>;

function commandText(value: unknown, label: string, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new McpIsolationError(`${label}无效。`, "TOOL_NOT_ALLOWED", 400, "sellfox");
  return value.trim();
}

export async function manageSellfoxMcpCredential(scope: SellfoxMcpScope, actor: string, command: SellfoxMcpCommand) {
  return prisma.$transaction(async tx => {
    const action = commandText(command.action, "操作", 20);
    const userId = command.userId === undefined ? actor : commandText(command.userId, "成员");
    const prior = command.id
      ? await tx.sellfoxMcpCredential.findFirst({ where: { ...scope, id: commandText(command.id, "凭证"), ...(userId === actor ? { userId } : {}) } })
      : null;
    if (action !== "create" && (!prior || prior.revision !== command.revision)) throw new McpIsolationError("凭证不可访问或版本已变化。", "TOOL_NOT_ALLOWED", 409, "sellfox");
    if (action === "disable" || action === "revoke") {
      if ((action === "disable" && prior?.status !== "ACTIVE") || (action === "revoke" && prior?.status === "REVOKED")) {
        throw new McpIsolationError("凭证状态已变化。", "TOOL_NOT_ALLOWED", 409, "sellfox");
      }
      const row = await tx.sellfoxMcpCredential.update({
        where: { id: prior!.id, revision: prior!.revision },
        data: { status: action === "disable" ? "DISABLED" : "REVOKED", revision: { increment: 1 } },
        select: credentialSelect,
      });
      await tx.auditLog.create({
        data: {
          organizationId: scope.organizationId, userId: actor, action: mcpAuditAction("sellfox", `credential.${action}`),
          entityType: "SellfoxMcpCredential", entityId: row.id, metadata: { workspaceId: scope.workspaceId, provider: "sellfox", subjectUserId: userId },
        },
      });
      return { credential: row };
    }
    if (!["create", "rotate"].includes(action) || (action === "rotate" && prior?.status !== "ACTIVE")) throw new McpIsolationError("操作不可用。", "TOOL_NOT_ALLOWED", 400, "sellfox");
    const tools = normalizeSellfoxToolGrants(action === "rotate" ? prior!.tools : Array.isArray(command.tools) ? command.tools as string[] : []);
    if (!tools.length) throw new McpIsolationError("至少授权一个工具。", "TOOL_NOT_ALLOWED", 400, "sellfox");
    const requestedStores = action === "rotate" ? prior!.storeIds : Array.isArray(command.storeIds) ? command.storeIds.map(String) : [];
    const stores = await tx.sellfoxStore.findMany({ where: { ...scope, ...(requestedStores.length ? { id: { in: requestedStores } } : {}) }, select: { id: true } });
    if (requestedStores.length && stores.length !== requestedStores.length) throw new McpIsolationError("店铺不在当前组织/工作区范围。", "STORE_NOT_ALLOWED", 403, "sellfox");
    const storeIds = requestedStores.length ? stores.map(store => store.id) : [];
    const expiresAt = action === "rotate" ? prior!.expiresAt : new Date(String(command.expiresAt));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date() || expiresAt.getTime() > Date.now() + 90 * 86400000) {
      throw new McpIsolationError("有效期须在未来 90 天内。", "TOOL_NOT_ALLOWED", 400, "sellfox");
    }
    const token = `${SELLFOX_MCP_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    if (prior) await tx.sellfoxMcpCredential.update({ where: { id: prior.id, revision: prior.revision }, data: { status: "REVOKED", revision: { increment: 1 } } });
    const row = await tx.sellfoxMcpCredential.create({
      data: {
        id: randomUUID(), ...scope, userId, name: action === "rotate" ? prior!.name : commandText(command.name, "名称", 100),
        tokenHash: sellfoxMcpTokenHash(token), tokenPrefix: token.slice(0, 12), tools, storeIds,
        scopes: storeIds, expiresAt, createdByUserId: actor, rotatedFromId: prior?.id ?? null,
      },
      select: credentialSelect,
    });
    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId, userId: actor, action: mcpAuditAction("sellfox", `credential.${action}`),
        entityType: "SellfoxMcpCredential", entityId: row.id,
        metadata: { workspaceId: scope.workspaceId, provider: "sellfox", subjectUserId: userId, tools: row.tools, storeCount: row.storeIds.length },
      },
    });
    return { credential: row, token };
  });
}

/* ------------------------------------------------------------------ */
/* read-only query layer                                               */
/* ------------------------------------------------------------------ */

let poolSingleton: Pool | null = null;
function pool() {
  const url = process.env.MCP_PG_READONLY_URL?.trim();
  if (!url) throw new McpIsolationError("赛狐只读数据库连接未配置（MCP_PG_READONLY_URL）。", "PROVIDER_MISMATCH", 503, "sellfox");
  poolSingleton ??= new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 30_000, statement_timeout: 30_000, query_timeout: 35_000, options: "-c default_transaction_read_only=on -c lock_timeout=3000" });
  return poolSingleton;
}

async function readOnlyQuery<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = 30000");
    const result = await client.query<T>(sql, params);
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

class SellfoxScopeSql {
  readonly params: unknown[] = [];
  private fenceIndex: number | null = null;
  constructor(private readonly identity: SellfoxMcpIdentity) {
    this.params.push(identity.organizationId, identity.workspaceId);
  }
  /** Same array parameter is reused by every subquery of one statement. */
  fence(alias: string, column = "storeId") {
    if (this.identity.storeScope.includes("*")) return "";
    if (this.fenceIndex === null) {
      this.params.push(this.identity.storeScope);
      this.fenceIndex = this.params.length;
    }
    return ` AND ${alias}."${column}" = ANY($${this.fenceIndex}::text[])`;
  }
  add(value: unknown) {
    this.params.push(value);
    return `$${this.params.length}`;
  }
  where(alias: string, column = "storeId") {
    return `${alias}."organizationId" = $1 AND ${alias}."workspaceId" = $2${this.fence(alias, column)}`;
  }
}

type ToolArgs = Record<string, unknown>;

function validateArgs(definition: SellfoxMcpToolDefinition, raw: unknown, storeScope: readonly string[]): ToolArgs {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new McpIsolationError("参数必须是对象。", "TOOL_NOT_ALLOWED", 400, "sellfox");
  const args = raw as ToolArgs;
  const properties = (definition.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const key of Object.keys(args)) if (!Object.hasOwn(properties, key)) throw new McpIsolationError(`参数「${key}」不属于该工具。`, "TOOL_NOT_ALLOWED", 400, "sellfox");
  for (const key of (definition.inputSchema.required as string[] | undefined) ?? []) if (args[key] === undefined) throw new McpIsolationError(`缺少参数「${key}」。`, "TOOL_NOT_ALLOWED", 400, "sellfox");
  for (const [key, value] of Object.entries(args)) {
    const spec = properties[key];
    if (spec.type === "integer") {
      if (typeof value !== "number" || !Number.isInteger(value)) throw new McpIsolationError(`参数「${key}」必须是整数。`, "TOOL_NOT_ALLOWED", 400, "sellfox");
      if (typeof spec.minimum === "number" && value < spec.minimum) throw new McpIsolationError(`参数「${key}」过小。`, "TOOL_NOT_ALLOWED", 400, "sellfox");
      if (typeof spec.maximum === "number" && value > spec.maximum) throw new McpIsolationError(`参数「${key}」过大。`, "TOOL_NOT_ALLOWED", 400, "sellfox");
      continue;
    }
    if (typeof value !== "string" || !value || value.length > 200 || value !== value.trim()) throw new McpIsolationError(`参数「${key}」无效。`, "TOOL_NOT_ALLOWED", 400, "sellfox");
    if (key === "dataset" && !sellfoxDatasetKeys.includes(value)) throw new McpIsolationError(`未知数据集「${value}」。`, "DATASET_NOT_ALLOWED", 403, "sellfox");
    if (typeof spec.format === "string" && spec.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new McpIsolationError(`参数「${key}」须为 YYYY-MM-DD。`, "TOOL_NOT_ALLOWED", 400, "sellfox");
  }
  if (typeof args.storeId === "string") assertCredentialStores("sellfox", storeScope, [args.storeId]);
  return args;
}

function limitOf(args: ToolArgs, fallback: number) {
  const value = args.limit === undefined ? fallback : Number(args.limit);
  return Math.min(MAX_MCP_LIMIT, Math.max(1, Number.isFinite(value) ? Math.trunc(value) : fallback));
}

async function toolStores(identity: SellfoxMcpIdentity) {
  const scope = new SellfoxScopeSql(identity);
  const dataset = sellfoxDataset("stores");
  const rows = await readOnlyQuery(
    `SELECT t."id", t.${dataset.columns.join(", t.")} FROM "${dataset.table}" t WHERE ${scope.where("t", dataset.storeColumn!)} ORDER BY t.name ASC LIMIT ${dataset.defaultLimit}`,
    scope.params,
  );
  return { count: rows.length, rows };
}

async function toolOverview(identity: SellfoxMcpIdentity) {
  const rows = await Promise.all(Object.values(sellfoxDatasets).map(async dataset => {
    const scope = new SellfoxScopeSql(identity);
    const storeCount = dataset.storeColumn ? `, count(DISTINCT t."${dataset.storeColumn}")::int AS stores` : "";
    try {
      const [row] = await readOnlyQuery<{ n: number; latest: string | null; stores?: number }>(
        `SELECT count(*)::int AS n, max(t."${dataset.dateField}")::text AS latest${storeCount} FROM "${dataset.table}" t WHERE ${scope.where("t", dataset.storeColumn ?? "storeId")}`,
        scope.params,
      );
      return { dataset: dataset.key, label: dataset.label, rows: row?.n ?? 0, latest: row?.latest ?? null, stores: dataset.storeColumn ? row?.stores ?? 0 : null };
    } catch (error) {
      return { dataset: dataset.key, label: dataset.label, rows: 0, latest: null, stores: null, error: error instanceof Error ? error.message.slice(0, 80) : "query failed" };
    }
  }));
  return { rows };
}

async function toolQueryData(identity: SellfoxMcpIdentity, args: ToolArgs) {
  const dataset = sellfoxDataset(String(args.dataset ?? ""));
  const scope = new SellfoxScopeSql(identity);
  const where = [scope.where("t", dataset.storeColumn ?? "storeId")];
  if (dataset.storeColumn && typeof args.storeId === "string") where.push(`t."${dataset.storeColumn}" = ${scope.add(args.storeId)}`);
  if (typeof args.fromDate === "string") where.push(`t."${dataset.dateField}" >= ${scope.add(args.fromDate)}::date`);
  if (typeof args.toDate === "string") where.push(`t."${dataset.dateField}" <= ${scope.add(args.toDate)}::date`);
  const limit = limitOf(args, dataset.defaultLimit);
  const offset = args.offset === undefined ? 0 : Math.max(0, Number(args.offset));
  const rows = await readOnlyQuery(
    `SELECT t.${dataset.columns.join(", t.")} FROM "${dataset.table}" t WHERE ${where.join(" AND ")} ORDER BY t."${dataset.dateField}" DESC LIMIT ${limit} OFFSET ${offset}`,
    scope.params,
  );
  return { dataset: dataset.key, count: rows.length, rows };
}

async function toolRestock(identity: SellfoxMcpIdentity, args: ToolArgs) {
  const scope = new SellfoxScopeSql(identity);
  const coverDays = args.maxCoverDays === undefined ? 30 : Number(args.maxCoverDays);
  const sales = scope.where("s", "storeId");
  const stock = scope.where("i", "storeId");
  const transit = scope.where("i2", "storeId");
  const storeFilter = typeof args.storeId === "string" ? ` AND r."storeId" = ${scope.add(args.storeId)}` : "";
  const sql = `
    WITH rates AS (
      SELECT sd."storeId", sd."msku", max(sd.asin) AS asin,
        (0.5 * avg(sd.qty_d) FILTER (WHERE sd.d::date >= current_date - 7)
       + 0.3 * avg(sd.qty_d) FILTER (WHERE sd.d::date BETWEEN current_date - 14 AND current_date - 8)
       + 0.2 * avg(sd.qty_d) FILTER (WHERE sd.d::date BETWEEN current_date - 30 AND current_date - 15)) AS daily_rate
      FROM (
        SELECT s."storeId", s."msku", max(s.asin) AS asin, s."reportDate" AS d, sum(s.quantity) AS qty_d
        FROM "SellfoxSalesDailySnapshot" s
        WHERE ${sales} AND s."reportDate"::date > current_date - 32
        GROUP BY 1, 2, 4
      ) sd WHERE sd.qty_d IS NOT NULL AND sd.qty_d >= 0 GROUP BY 1, 2
    ), stock AS (
      SELECT DISTINCT ON (i."storeId", i."msku") i."storeId", i."msku",
        sum(i.quantity) OVER (PARTITION BY i."storeId", i."msku") AS on_hand
      FROM "SellfoxFbaInventorySnapshot" i WHERE ${stock}
      ORDER BY i."storeId", i."msku", i."reportDate" DESC
    ), transit AS (
      SELECT i2."storeId", i2."msku" AS sku,
        (COALESCE(i2."inTransit", 0) + COALESCE(i2."inboundShipped", 0) + COALESCE(i2."inboundWorking", 0))::int AS in_transit
      FROM (
        SELECT DISTINCT ON (i2."storeId", i2."msku") i2."storeId", i2."msku", i2."inTransit", i2."inboundShipped", i2."inboundWorking"
        FROM "SellfoxFbaInventorySnapshot" i2 WHERE ${transit}
        ORDER BY i2."storeId", i2."msku", i2."reportDate" DESC
      ) i2
    )
    SELECT r."storeId", r."msku", r.asin, round(r.daily_rate::numeric, 2) AS daily_rate,
      COALESCE(st.on_hand, 0) AS on_hand, COALESCE(tg.in_transit, 0) AS in_transit,
      CASE WHEN r.daily_rate > 0 THEN round((COALESCE(st.on_hand, 0) / r.daily_rate)::numeric, 1) ELSE NULL END AS cover_days,
      CASE WHEN r.daily_rate > 0 THEN round((r.daily_rate * ${coverDays} - COALESCE(st.on_hand, 0) - COALESCE(tg.in_transit, 0))::numeric, 0) ELSE NULL END AS suggested_qty
    FROM rates r
    LEFT JOIN stock st ON st."storeId" = r."storeId" AND st."msku" = r."msku"
    LEFT JOIN transit tg ON tg."storeId" = r."storeId" AND tg.sku = r."msku"
    WHERE r.daily_rate > 0${storeFilter}
    ORDER BY cover_days ASC NULLS LAST LIMIT ${limitOf(args, 100)}`;
  const rows = await readOnlyQuery(sql, scope.params);
  return { count: rows.length, policy: "备货30天/安全7天，7:14:30 加权日销", rows };
}

async function toolAdsDiagnosis(identity: SellfoxMcpIdentity, args: ToolArgs) {
  const scope = new SellfoxScopeSql(identity);
  const days = args.days === undefined ? 14 : Number(args.days);
  const ads = scope.where("a", "storeId");
  const sales = scope.where("s", "storeId");
  const stock = scope.where("i", "storeId");
  const storeFilter = typeof args.storeId === "string" ? ` AND sp."storeId" = ${scope.add(args.storeId)}` : "";
  const daysParam = scope.add(Math.min(90, Math.max(1, days)));
  const sql = `
    WITH spend AS (
      SELECT a."storeId", a.asin, sum(a.cost) AS spend, sum(a."adSales") AS sales, sum(a.clicks) AS clicks, sum(a.impressions) AS impr, sum(a."adOrders") AS orders
      FROM "SellfoxAdsProductDaily" a WHERE ${ads} AND a."reportDate"::date > current_date - ${daysParam}::int GROUP BY 1, 2
    ), restock AS (
      SELECT r."storeId", r."msku", r.asin, c.cover_days, r.on_hand, r.daily_rate FROM (
        SELECT day."storeId", day."msku", max(day.asin) AS asin,
          (0.5 * avg(day.qty) FILTER (WHERE day.d::date >= current_date - 7)
         + 0.3 * avg(day.qty) FILTER (WHERE day.d::date BETWEEN current_date - 14 AND current_date - 8)
         + 0.2 * avg(day.qty) FILTER (WHERE day.d::date BETWEEN current_date - 30 AND current_date - 15)) AS daily_rate,
          (array_agg(oh.on_hand ORDER BY day.d DESC))[1] AS on_hand
        FROM (
          SELECT s."storeId", s."msku", max(s.asin) AS asin, s."reportDate" AS d, sum(s.quantity) AS qty
          FROM "SellfoxSalesDailySnapshot" s WHERE ${sales} AND s."reportDate"::date > current_date - 32 GROUP BY 1, 2, 4
        ) day, LATERAL (
          SELECT sum(i.quantity) AS on_hand FROM "SellfoxFbaInventorySnapshot" i
          WHERE ${stock} AND i."storeId" = day."storeId" AND i."msku" = day."msku"
        ) oh
        WHERE day.qty IS NOT NULL GROUP BY 1, 2
      ) r
      CROSS JOIN LATERAL (SELECT CASE WHEN r.daily_rate > 0 THEN round((COALESCE(r.on_hand, 0) / r.daily_rate)::numeric, 1) ELSE NULL END AS cover_days) c
      WHERE r.daily_rate > 0
    )
    SELECT sp."storeId", sp.asin, round(sp.spend::numeric, 2) AS spend, round(sp.sales::numeric, 2) AS sales,
      CASE WHEN sp.spend > 0 THEN round((sp.sales / sp.spend)::numeric, 2) ELSE NULL END AS roas,
      CASE WHEN sp.sales > 0 THEN round((sp.spend / sp.sales * 100)::numeric, 1) ELSE NULL END AS acos_pct,
      sp.clicks, sp.impr, sp.orders, rs.cover_days, rs.on_hand, round(rs.daily_rate::numeric, 2) AS daily_rate
    FROM spend sp LEFT JOIN restock rs ON rs."storeId" = sp."storeId" AND rs.asin = sp.asin
    WHERE true${storeFilter} ORDER BY sp.spend DESC LIMIT ${limitOf(args, 100)}`;
  const rows = await readOnlyQuery(sql, scope.params);
  return { windowDays: Math.min(90, Math.max(1, days)), count: rows.length, rows };
}

async function toolSalesTrend(identity: SellfoxMcpIdentity, args: ToolArgs) {
  const scope = new SellfoxScopeSql(identity);
  const days = args.days === undefined ? 30 : Number(args.days);
  const daysParam = scope.add(Math.min(90, Math.max(1, days)));
  const where = scope.where("s", "storeId");
  const storeFilter = typeof args.storeId === "string" ? ` AND s."storeId" = ${scope.add(args.storeId)}` : "";
  const rows = await readOnlyQuery(
    `SELECT s."reportDate", sum(s."orderNum") AS orders, round(sum(s."salePrice")::numeric, 2) AS gmv, count(DISTINCT s."storeId")::int AS stores
     FROM "SellfoxSalesDailySnapshot" s WHERE ${where} AND s."reportDate"::date > current_date - ${daysParam}::int${storeFilter}
     GROUP BY s."reportDate" ORDER BY s."reportDate" DESC`,
    scope.params,
  );
  return { windowDays: Math.min(90, Math.max(1, days)), rows };
}

/* ------------------------------------------------------------------ */
/* invocation                                                          */
/* ------------------------------------------------------------------ */

export async function invokeSellfoxMcp(identity: SellfoxMcpIdentity, tool: string, rawArgs: unknown, requestId = randomUUID()) {
  const startedAt = Date.now();
  let definition: SellfoxMcpToolDefinition | null = null;
  try {
    definition = sellfoxMcpDefinition(tool);
    assertCredentialTool("sellfox", normalizeSellfoxToolGrants(identity.tools), definition.name);
    const args = validateArgs(definition, rawArgs, identity.storeScope);
    let data: unknown;
    switch (definition.name) {
      case "sellfox.stores.list": data = await toolStores(identity); break;
      case "sellfox.dataset.overview": data = await toolOverview(identity); break;
      case "sellfox.query_data": data = await toolQueryData(identity, args); break;
      case "sellfox.restock_suggestions": data = await toolRestock(identity, args); break;
      case "sellfox.ads_diagnosis": data = await toolAdsDiagnosis(identity, args); break;
      case "sellfox.sales_trend": data = await toolSalesTrend(identity, args); break;
    }
    await audit(identity, "tool.succeeded", {
      credentialId: identity.id, requestId, tool: definition.name, toolVersion: definition.version,
      durationMs: Date.now() - startedAt, dataset: typeof args.dataset === "string" ? args.dataset : null,
      storeId: typeof args.storeId === "string" ? args.storeId : null,
      returnedCount: Array.isArray((data as { rows?: unknown[] })?.rows) ? (data as { rows: unknown[] }).rows.length : undefined,
    });
    return data;
  } catch (error) {
    const businessCode = error instanceof McpIsolationError ? error.code : "EXECUTION_FAILED";
    await audit(identity, "tool.denied", {
      credentialId: identity.id, requestId, tool: definition?.name ?? tool.slice(0, 120), toolVersion: definition?.version ?? null,
      durationMs: Date.now() - startedAt, failureClass: "ACCESS_DENIED", businessCode,
      reason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    throw error;
  }
}

export function sellfoxMcpCatalog() {
  return sellfoxMcpToolDefinitions.map(tool => ({ name: tool.name, description: tool.description, operationMode: tool.operationMode, version: tool.version, inputSchema: tool.inputSchema }));
}

/**
 * Settings-page connectivity check. Uses the same pool, transaction mode and
 * statement timeout as real tool calls, so a green result means a query would
 * actually run. Never returns SQL text or driver internals to the caller.
 */
export async function probeSellfoxReadOnly(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  const startedAt = Date.now();
  try {
    await readOnlyQuery("SELECT 1 AS ok", []);
    return { ok: true, latencyMs: Date.now() - startedAt, detail: `只读连接可用（${Date.now() - startedAt} ms）` };
  } catch (error) {
    const message = error instanceof McpIsolationError
      ? error.message
      : (error as { code?: string })?.code === "28P01" ? "只读角色认证失败，请核对 DSN 密码。"
        : (error as { code?: string })?.code === "3D000" ? "只读连接指向的数据库不存在。" : "只读连接不可用，请检查 MCP_PG_READONLY_URL。";
    return { ok: false, latencyMs: Date.now() - startedAt, detail: message };
  }
}
