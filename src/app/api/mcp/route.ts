/**
 * Sellfox MCP Server (Streamable HTTP transport).
 *
 * Read-only analysis endpoint for external agents (Codex, WorkBuddy, ...).
 * Security model:
 *  - Bearer token (MCP_HTTP_TOKEN) gates every request.
 *  - All SQL executes through a dedicated read-only Postgres role
 *    (MCP_PG_READONLY_URL, statement_timeout 30s, read-only transactions).
 *  - Dataset/tables/columns come from a static allow-list below; user input
 *    is always parameterized ($1..$n), never string-concatenated.
 *  - Queries are hard-scoped to MCP_ORG_ID / MCP_WORKSPACE_ID.
 */
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Dataset = { table: string; label: string; dateField: string; storeField: string | null; columns: string[]; description: string };

const ORG = process.env.MCP_ORG_ID ?? "";
const WORKSPACE = process.env.MCP_WORKSPACE_ID ?? "default";

const DATASETS: Record<string, Dataset> = {
  stores: { table: "SellfoxStore", label: "店铺", dateField: "updatedAt", storeField: null,
    columns: ["\"externalId\"", "name", "marketplace", "country", "status"], description: "39 个 Amazon 店铺主数据" },
  listings: { table: "SellfoxListingSnapshot", label: "在线产品", dateField: "capturedAt", storeField: "storeId",
    columns: ["\"storeId\"", "\"msku\"", "asin", "title", "price", "quantity", "status", "\"capturedAt\""], description: "Listing 快照（价格/库存/状态）" },
  inventory: { table: "SellfoxFbaInventorySnapshot", label: "FBA库存", dateField: "reportDate", storeField: "storeId",
    columns: ["\"storeId\"", "\"msku\"", "asin", "fulfillment", "quantity", "\"reportDate\""], description: "FBA 库存明细（按仓库类型）" },
  sales: { table: "SellfoxSalesDailySnapshot", label: "销量日快照", dateField: "reportDate", storeField: "storeId",
    columns: ["\"storeId\"", "\"msku\"", "asin", "\"reportDate\"", "\"orderNum\"", "\"salePrice\"", "\"productNum\""], description: "店铺×日×MSKU 销量与销售额" },
  orders: { table: "SellfoxOrderSnapshot", label: "订单", dateField: "purchaseDate", storeField: "storeId",
    columns: ["\"storeId\"", "\"orderId\"", "asin", "\"msku\"", "\"purchaseDate\"", "quantity", "\"itemPrice\"", "status", "fulfillment"], description: "订单明细（近 30 天滚动）" },
  performance: { table: "SellfoxProductDailySnapshot", label: "产品利润日报", dateField: "reportDate", storeField: "storeId",
    columns: ["\"storeId\"", "asin", "\"msku\"", "\"reportDate\"", "\"orderNum\"", "revenue", "profit", "margin"], description: "产品维度日利润" },
  ads_product: { table: "SellfoxAdsProductDaily", label: "广告产品日报", dateField: "reportDate", storeField: "storeId",
    columns: ["\"storeId\"", "asin", "\"reportDate\"", "impressions", "clicks", "ctr", "spend", "sales", "acos", "orders"], description: "ASIN 维度广告表现" },
  ads_campaign: { table: "SellfoxAdsCampaignDaily", label: "广告活动日报", dateField: "reportDate", storeField: "storeId",
    columns: ["\"storeId\"", "campaignName", "\"reportDate\"", "impressions", "clicks", "spend", "sales", "acos", "orders"], description: "广告活动维度表现" },
  fba_shipments: { table: "SellfoxFbaShipmentSnapshot", label: "FBA货件", dateField: "createdAt", storeField: "storeId",
    columns: ["\"storeId\"", "\"shipmentId\"", "sku", "quantity", "status", "\"createdAt\""], description: "FBA 入库货件" },
};

const MAX_LIMIT = 500;

function pool(): Pool {
  const url = process.env.MCP_PG_READONLY_URL;
  if (!url) throw new Error("MCP_PG_READONLY_URL is not configured");
  return new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 30_000 });
}
let poolSingleton: Pool | null = null;
function db() { return (poolSingleton ??= pool()); }

function scopeClause() { return `t."organizationId" = $1 AND t."workspaceId" = $2`; }
const SCOPE_ARGS = () => [ORG, WORKSPACE];

// ---------- tool implementations ----------

async function toolDatasetOverview() {
  const entries = Object.entries(DATASETS);
  const rows = await Promise.all(entries.map(async ([key, d]) => {
    const storeSel = d.storeField ? `, count(DISTINCT "${d.storeField}")::int AS stores` : "";
    try {
      const r = await db().query(
        `SELECT count(*)::int AS n, max("${d.dateField}")::text AS latest${storeSel} FROM "${d.table}" t WHERE ${scopeClause()}`,
        SCOPE_ARGS(),
      );
      return { dataset: key, label: d.label, rows: r.rows[0].n, latest: r.rows[0].latest, stores: d.storeField ? r.rows[0].stores : null };
    } catch (error) {
      return { dataset: key, label: d.label, rows: 0, latest: null, stores: null, error: error instanceof Error ? error.message.slice(0, 80) : "query failed" };
    }
  }));
  return { content: [{ type: "text", text: JSON.stringify(rows, null, 1) }] };
}

async function toolQueryData(args: Record<string, unknown>) {
  const dataset = String(args.dataset ?? "");
  const d = DATASETS[dataset];
  if (!d) throw new McpInputError(`未知数据集「${dataset}」，可用：${Object.keys(DATASETS).join(", ")}`);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(args.limit ?? 50) || 50));
  const offset = Math.max(0, Number(args.offset ?? 0) || 0);
  const params: unknown[] = [...SCOPE_ARGS()];
  const where: string[] = [scopeClause()];
  if (d.storeField && args.storeId) { params.push(String(args.storeId)); where.push(`t."${d.storeField}" = $${params.length}`); }
  if (args.fromDate) { params.push(String(args.fromDate)); where.push(`t."${d.dateField}" >= $${params.length}::date`); }
  if (args.toDate) { params.push(String(args.toDate)); where.push(`t."${d.dateField}" <= $${params.length}::date`); }
  const cols = d.columns.map(c => `t.${c}`).join(", ");
  const sql = `SELECT ${cols} FROM "${d.table}" t WHERE ${where.join(" AND ")} ORDER BY t."${d.dateField}" DESC LIMIT ${limit} OFFSET ${offset}`;
  const r = await db().query(sql, params);
  return { content: [{ type: "text", text: JSON.stringify({ dataset, count: r.rows.length, rows: r.rows }, null, 1) }] };
}

async function toolRestockSuggestions(args: Record<string, unknown>) {
  const minCoverDays = Math.max(0, Number(args.maxCoverDays ?? 30) || 30);
  // Weighted daily rate (7/14/30 = 0.5/0.3/0.2) over last 30 sold days, stockout days (null qty) excluded,
  // matched with latest FBA on-hand per store+msku. Mirrors src/lib/sellfox/restock.ts policy.
  const sql = `
    WITH rates AS (
      SELECT "storeId", "msku", max(asin) AS asin,
        (0.5 * avg(qty) FILTER (WHERE d >= current_date - 7)
       + 0.3 * avg(qty) FILTER (WHERE d BETWEEN current_date - 14 AND current_date - 8)
       + 0.2 * avg(qty) FILTER (WHERE d BETWEEN current_date - 30 AND current_date - 15)) AS daily_rate
      FROM (
        SELECT "storeId", "msku", max(asin) AS asin, "reportDate" AS d, sum("productNum") AS qty
        FROM "SellfoxSalesDailySnapshot"
        WHERE "organizationId" = $1 AND "workspaceId" = $2 AND "reportDate" > current_date - 32
        GROUP BY 1, 2, 4
      ) s
      WHERE qty IS NOT NULL AND qty >= 0
      GROUP BY 1, 2
    ),
    stock AS (
      SELECT DISTINCT ON ("storeId", "msku") "storeId", "msku", sum(quantity) OVER (PARTITION BY "storeId", "msku") AS on_hand
      FROM "SellfoxFbaInventorySnapshot"
      WHERE "organizationId" = $1 AND "workspaceId" = $2
      ORDER BY "storeId", "msku", "reportDate" DESC
    ),
    transit AS (
      SELECT "storeId", sku, sum(quantity)::int AS in_transit
      FROM "SellfoxFbaShipmentSnapshot"
      WHERE "organizationId" = $1 AND "workspaceId" = $2 AND status NOT IN ('Shipped','DELIVERED','CHECKED_IN','RECEIVING','CLOSED','CANCELLED')
      GROUP BY 1, 2
    )
    SELECT r."storeId", r."msku", r.asin,
      round(r.daily_rate::numeric, 2) AS daily_rate,
      COALESCE(st.on_hand, 0) AS on_hand,
      COALESCE(tr.in_transit, 0) AS in_transit,
      CASE WHEN r.daily_rate > 0 THEN round((COALESCE(st.on_hand, 0) / r.daily_rate)::numeric, 1) ELSE NULL END AS cover_days,
      CASE WHEN r.daily_rate > 0 THEN round((r.daily_rate * ${minCoverDays} - COALESCE(st.on_hand, 0) - COALESCE(tr.in_transit, 0))::numeric, 0) ELSE NULL END AS suggested_qty
    FROM rates r
    LEFT JOIN stock st ON st."storeId" = r."storeId" AND st."msku" = r."msku"
    LEFT JOIN transit tr ON tr."storeId" = r."storeId" AND tr.sku = r."msku"
    WHERE r.daily_rate > 0
    ORDER BY cover_days ASC NULLS LAST
    LIMIT ${Math.min(MAX_LIMIT, Math.max(1, Number(args.limit ?? 100) || 100))}`;
  const r = await db().query(sql, SCOPE_ARGS());
  return { content: [{ type: "text", text: JSON.stringify({ count: r.rows.length, policy: "备货30天/安全7天，7:14:30 加权日销", rows: r.rows }, null, 1) }] };
}

async function toolAdsDiagnosis(args: Record<string, unknown>) {
  const days = Math.min(90, Math.max(1, Number(args.days ?? 14) || 14));
  const params: unknown[] = [...SCOPE_ARGS(), days];
  const storeFilter = args.storeId ? (() => { params.push(String(args.storeId)); return ` AND a."storeId" = $${params.length}`; })() : "";
  const sql = `
    WITH spend AS (
      SELECT "storeId", asin, sum(spend) AS spend, sum(sales) AS sales, sum(clicks) AS clicks, sum(impressions) AS impr, sum(orders) AS orders
      FROM "SellfoxAdsProductDaily" a
      WHERE "organizationId" = $1 AND "workspaceId" = $2 AND "reportDate" > current_date - $3::int ${storeFilter}
      GROUP BY 1, 2
    ),
    restock AS (
      SELECT r."storeId", r."msku", r.cover_days, r.on_hand, r.daily_rate FROM (
        SELECT "storeId", "msku",
          (0.5 * avg(qty) FILTER (WHERE d >= current_date - 7) + 0.3 * avg(qty) FILTER (WHERE d BETWEEN current_date - 14 AND current_date - 8) + 0.2 * avg(qty) FILTER (WHERE d BETWEEN current_date - 30 AND current_date - 15)) AS daily_rate,
          (array_agg(on_hand ORDER BY d DESC))[1] AS on_hand
        FROM (
          SELECT s."storeId", s."msku", s."reportDate" AS d, sum(s."productNum") AS qty
          FROM "SellfoxSalesDailySnapshot" s
          WHERE s."organizationId" = $1 AND s."workspaceId" = $2 AND s."reportDate" > current_date - 32
          GROUP BY 1, 2, 3
        ) day, LATERAL (
          SELECT sum(quantity) AS on_hand FROM "SellfoxFbaInventorySnapshot" i
          WHERE i."organizationId" = $1 AND i."workspaceId" = $2 AND i."storeId" = day."storeId" AND i."msku" = day."msku"
        ) oh
        WHERE qty IS NOT NULL
        GROUP BY 1, 2
      ) r WHERE r.daily_rate > 0
    )
    SELECT sp."storeId", sp.asin,
      round(sp.spend::numeric, 2) AS spend, round(sp.sales::numeric, 2) AS sales,
      CASE WHEN sp.spend > 0 THEN round((sp.sales / sp.spend)::numeric, 2) ELSE NULL END AS roas,
      CASE WHEN sp.sales > 0 THEN round((sp.spend / sp.sales * 100)::numeric, 1) ELSE NULL END AS acos_pct,
      sp.clicks, sp.impr, sp.orders,
      rs.cover_days, rs.on_hand, round(rs.daily_rate::numeric, 2) AS daily_rate
    FROM spend sp LEFT JOIN restock rs ON rs."storeId" = sp."storeId" AND rs."msku" = sp.asin
    ORDER BY sp.spend DESC
    LIMIT ${Math.min(MAX_LIMIT, Math.max(1, Number(args.limit ?? 100) || 100))}`;
  const r = await db().query(sql, params);
  return { content: [{ type: "text", text: JSON.stringify({ windowDays: days, count: r.rows.length, rows: r.rows }, null, 1) }] };
}

async function toolSalesTrend(args: Record<string, unknown>) {
  const days = Math.min(90, Math.max(1, Number(args.days ?? 30) || 30));
  const params: unknown[] = [...SCOPE_ARGS(), days];
  const storeFilter = args.storeId ? (() => { params.push(String(args.storeId)); return ` AND "storeId" = $${params.length}`; })() : "";
  const sql = `SELECT "reportDate", sum("orderNum") AS orders, round(sum("salePrice")::numeric, 2) AS gmv, count(DISTINCT "storeId")::int AS stores
    FROM "SellfoxSalesDailySnapshot"
    WHERE "organizationId" = $1 AND "workspaceId" = $2 AND "reportDate" > current_date - $3::int ${storeFilter}
    GROUP BY "reportDate" ORDER BY "reportDate" DESC`;
  const r = await db().query(sql, params);
  return { content: [{ type: "text", text: JSON.stringify({ windowDays: days, rows: r.rows }, null, 1) }] };
}

class McpInputError extends Error {}

// ---------- MCP protocol ----------

const TOOLS = [
  { name: "dataset_overview", description: "列出所有已同步数据集的行数/最新日期/覆盖店铺数", inputSchema: { type: "object", properties: {} } },
  { name: "query_data", description: "按数据集查询明细行（支持店铺/日期过滤）", inputSchema: { type: "object", required: ["dataset"], properties: {
    dataset: { type: "string", enum: Object.keys(DATASETS) }, storeId: { type: "string" }, fromDate: { type: "string", description: "YYYY-MM-DD" }, toDate: { type: "string" }, limit: { type: "number", maximum: MAX_LIMIT }, offset: { type: "number" } } } },
  { name: "restock_suggestions", description: "补货建议：加权日销×FBA在手×在途，输出可售天数与建议补货量（口径：备货30天/安全7天）", inputSchema: { type: "object", properties: { maxCoverDays: { type: "number" }, limit: { type: "number" } } } },
  { name: "ads_diagnosis", description: "广告×库存联动诊断：每 ASIN 花费/ROAS/ACOS + 可售天数，用于生成广告调整方案", inputSchema: { type: "object", properties: { days: { type: "number" }, storeId: { type: "string" }, limit: { type: "number" } } } },
  { name: "sales_trend", description: "日销量/销售额趋势", inputSchema: { type: "object", properties: { days: { type: "number" }, storeId: { type: "string" } } } },
];

const IMPLEMENTATIONS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  dataset_overview: () => toolDatasetOverview(),
  query_data: toolQueryData,
  restock_suggestions: toolRestockSuggestions,
  ads_diagnosis: toolAdsDiagnosis,
  sales_trend: toolSalesTrend,
};

function rpcResult(id: unknown, result: unknown) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id: unknown, code: number, message: string) { return { jsonrpc: "2.0", id, error: { code, message } }; }

async function handleRpc(message: Record<string, unknown>) {
  const method = String(message.method ?? "");
  const id = message.id;
  if (method === "initialize") {
    return rpcResult(id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "sellfox-data", version: "1.0.0" } });
  }
  if (method === "notifications/initialized" || method.startsWith("notifications/")) return null; // notification: no response
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools: TOOLS });
  if (method === "tools/call") {
    const params = (message.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    const impl = IMPLEMENTATIONS[String(params.name ?? "")];
    if (!impl) return rpcError(id, -32602, `未知工具「${params.name}」`);
    try {
      const result = await impl(params.arguments ?? {});
      return rpcResult(id, result);
    } catch (error) {
      const messageText = error instanceof McpInputError ? error.message : error instanceof Error ? `查询失败：${error.message.slice(0, 160)}` : "查询失败";
      return rpcResult(id, { content: [{ type: "text", text: messageText }], isError: true });
    }
  }
  return rpcError(id, -32601, `未知方法「${method}」`);
}

export async function POST(request: NextRequest) {
  const token = process.env.MCP_HTTP_TOKEN;
  const auth = request.headers.get("authorization") ?? "";
  if (!token || auth !== `Bearer ${token}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!ORG) return NextResponse.json({ error: "MCP_ORG_ID not configured" }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json(rpcError(null, -32700, "解析失败"), { status: 400 }); }
  const messages = Array.isArray(body) ? body : [body];
  const responses = (await Promise.all(messages.map(m => handleRpc(m as Record<string, unknown>)))).filter(Boolean);
  return NextResponse.json(Array.isArray(body) ? responses : responses[0] ?? null);
}

export async function GET() {
  return NextResponse.json({ server: "sellfox-data", transport: "streamable-http", endpoint: "/api/mcp", tools: TOOLS.map(t => t.name) });
}
