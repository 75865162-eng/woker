/**
 * P4 接线层契约测试。
 *
 * P0–P3 内核已有独立单测；本文件验证「接线层」本身的完整性：
 *  1. A/B/D 各 service 导出预期的读写函数（签名存在性）；
 *  2. API 路由的 section/action 分发覆盖全部接线函数（无遗漏、无拼写漂移）；
 *  3. 路由对写操作按 approve/create 分级鉴权（架构红线：不自动过账）；
 *  4. 接线 service 确实引用了对应纯函数内核（防止"接线但用错内核"）；
 *  5. 关键架构红线在接线层的守卫（租户校验、幂等 upsert、无币种拒绝）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const factService = read("src/lib/gap-audit/fact-wiring-service.ts");
const computeService = read("src/lib/gap-audit/compute-wiring-service.ts");
const obsService = read("src/lib/gap-audit/observability-wiring-service.ts");
const materializeService = read("src/lib/gap-audit/materialize-wiring-service.ts");
const route = read("src/app/api/operations/gap-audit/route.ts");

test("P4-A fact-wiring-service 导出全部 A 批读写函数", () => {
  const expected = [
    "materializeSalesDailyFacts", "querySalesDailyFacts",
    "materializeOrderFinanceEvents", "queryOrderFinanceEvents",
    "queryAccountMappings", "mutateAccountMapping",
    "materializeMonthlyReconcile", "queryMonthlyReconcile",
    "queryFeeCategoryDict", "mutateFeeCategoryDict",
  ];
  for (const fn of expected) {
    assert.match(factService, new RegExp(`export async function ${fn}\\b`), `缺少导出：${fn}`);
  }
});

test("P4-B compute-wiring-service 导出全部 B/D 计算函数", () => {
  const expected = [
    "queryBalanceProjections", "rebuildBalanceProjection",
    "queryProfitConfig", "mutateProfitConfig", "resolveEffectiveProfitParams",
    "queryLiveProfit", "applyLiveProfitEvents",
    "queryConsolidation", "computeConsolidation",
    "queryFinanceAnomalies", "detectAnomalies", "checkVoucherFxEntries",
  ];
  for (const fn of expected) {
    assert.match(computeService, new RegExp(`export async function ${fn}\\b`), `缺少导出：${fn}`);
  }
});

test("P4-D observability service 导出观测函数并复用 cache-config", () => {
  assert.match(obsService, /export async function queryAuditObservability\b/);
  assert.match(obsService, /readCacheConfig/);
});

test("P4-D materialize service 导出物化/审计/编排函数且带 env 开关", () => {
  for (const fn of ["materializeAdsAttributionCoverage", "materializeInventoryPlanning", "auditMetricBases", "runMaterializations", "materializationSwitches"]) {
    assert.match(materializeService, new RegExp(`export (async )?function ${fn}\\b`), `缺少导出：${fn}`);
  }
  assert.match(materializeService, /GAP_AUDIT_MATERIALIZATION_ENABLED/);
  assert.match(materializeService, /computeAttributionCoverage\(/);
  assert.match(materializeService, /parseInventoryPlanningRow\(/);
});

test("路由 GET 分发覆盖全部读 section", () => {
  const sections = [
    "sales-daily-fact", "order-finance-event", "account-mapping", "monthly-reconcile", "fee-category-dict",
    "balance-projection", "profit-config", "live-profit", "consolidation", "finance-anomaly", "observability",
    "metric-audit",
  ];
  for (const s of sections) {
    assert.match(route, new RegExp(`case ['"]${s}['"]`), `GET 缺少 section：${s}`);
  }
});

test("路由 POST 分发覆盖全部写 action", () => {
  const actions = [
    "materialize-sales-daily-fact", "materialize-order-finance-events",
    "create-account-mapping", "review-account-mapping", "resolve-account-mapping",
    "materialize-monthly-reconcile", "upsert-fee-category",
    "rebuild-balance-projection", "create-profit-config", "review-profit-config",
    "apply-live-profit-events", "compute-consolidation", "push-consolidation",
    "detect-finance-anomalies", "check-voucher-fx", "resolve-profit-params",
    "materialize-ads-attribution", "materialize-inventory-planning", "run-materializations",
  ];
  for (const a of actions) {
    assert.match(route, new RegExp(`case ['"]${a}['"]`), `POST 缺少 action：${a}`);
  }
});

test("架构红线：写操作分级鉴权，review/rebuild/push 需 approve", () => {
  assert.match(route, /requireApiPermission\('operations', APPROVE_ACTIONS\.has\(action\) \? 'approve' : 'create', request\)/);
  for (const a of ["review-account-mapping", "rebuild-balance-projection", "review-profit-config", "push-consolidation"]) {
    assert.match(route, new RegExp(`'${a}'`), `approve 集合缺少：${a}`);
  }
});

test("架构红线：接线 service 调用真实内核（防接线错位）", () => {
  assert.match(factService, /buildSalesDailyFacts\(input\.lines\)/);
  assert.match(factService, /classifyFinanceEvent\(r\.eventType\)/);
  assert.match(factService, /financeEventEconomicKey\(identity\)/);
  assert.match(factService, /buildMonthlyReconcile\(params\.openItems/);
  assert.match(factService, /assertNoMappingConflicts\(/);
  assert.match(computeService, /rebuildBalanceProjectionKernel\(projectionInput\)/);
  assert.match(computeService, /buildProfitConfig\(\{/);
  assert.match(computeService, /applyProfitEvents\(state, input\.events/);
  assert.match(computeService, /consolidate\(\{/);
  assert.match(computeService, /detectFinanceAnomalies\(input\)/);
  assert.match(computeService, /checkFxEntries\(input\.lines/);
});

test("报告02 生产级：SalesDailyFact 净额列 schema / 迁移 / 写入 / 回读 全链路落地", () => {
  const schema = read("prisma/schema.prisma");
  const modelBlock = schema.slice(schema.indexOf("model SalesDailyFact {"), schema.indexOf("model SalesDailyFact {") + 1400);
  assert.match(modelBlock, /netUnits\s+Int\?/, "schema 缺 netUnits 列");
  assert.match(modelBlock, /netSales\s+Decimal\?/, "schema 缺 netSales 列");
  const migrations = read("prisma/migrations/20260101000000_sales_daily_fact_net/migration.sql");
  assert.match(migrations, /ADD COLUMN IF NOT EXISTS "netUnits"/);
  assert.match(migrations, /ADD COLUMN IF NOT EXISTS "netSales"/);
  // 写入：create/update 两处都写净额（intOrNull 保 null 不补零；netSales 走 Decimal 保真）
  const netWrites = factService.match(/netUnits:\s*intOrNull\(f\.netUnits\),\s*netSales:\s*new Prisma\.Decimal\(f\.netSales\)/g) ?? [];
  assert.equal(netWrites.length, 2, "create/update 均须落库净额");
  // 回读：query 返回净额且金额 toFixed 保真
  assert.match(factService, /netUnits:\s*r\.netUnits\s*\?\?\s*null/);
  assert.match(factService, /netSales:\s*r\.netSales\?\.toFixed\(6\)/);
  // 纯函数内核确实算净额（net = 销售 - 退款）
  const kernel = read("src/lib/amazon-sync/sales-daily-fact.ts");
  assert.match(kernel, /netSales:\s*fmt\(b\.sales - b\.refundAmount\)/);
});

test("架构红线：租户隔离 + 幂等 upsert 在接线层落地", () => {
  assert.match(factService, /requireScope\(scope\)/);
  assert.match(computeService, /requireScope\(scope\)/);
  assert.match(factService, /scoped\(scope\)/);
  // 所有落库走 upsert（幂等），不出现裸 create 覆盖幂等键
  const upsertCount = (factService.match(/\.upsert\(/g) ?? []).length;
  assert.ok(upsertCount >= 6, `事实层 upsert 数量不足：${upsertCount}`);
});

test("架构红线：外币/合并缺数据不臆造（NEEDS_DATA / 跨币种拒绝）", () => {
  assert.match(computeService, /CROSS_CURRENCY|跨币种/);
  assert.match(computeService, /NEEDS_DATA|缺汇率/);
  assert.match(computeService, /缺失|pendingSources/);
});

test("架构红线：不自动过账——接线 service 不写凭证表", () => {
  // 接线层只写事实/映射/对账/投影/配置表，绝不 create/update FinanceVoucher
  assert.doesNotMatch(factService, /financeVoucher\.(create|update|upsert|delete)/);
  assert.doesNotMatch(computeService, /financeVoucher\.(create|update|upsert|delete)/);
  // 账本投影虽有 voucherRows 读取，但写操作只针对 financeBalanceProjection
  assert.match(computeService, /financeBalanceProjection\.upsert/);
});

test("B2 以内核修正页面：computeProfit 对 SKU 行重算，缺成本 INCOMPLETE 不补零", async () => {
  const { recomputeSkuProfitWithKernel } = await import("../src/lib/gap-audit/compute-wiring-service");
  const scope = { organizationId: "o1", workspaceId: "w1", actorUserId: "u1" };
  const rows = [
    { sku: "A", settlementCurrency: "USD", settlementNet: "100.000000", distinctOrders: 2, lineCount: 2,
      costTotalConverted: "60.000000", fxRate: "7", netProfit: "40.000000", typeBreakdown: {},
      costCurrency: "CNY", purchaseCost: null, freightCost: null, otherCost: null, costTotalOriginal: null,
      netMargin: null, status: "OK" as const, note: null },
    { sku: "B", settlementCurrency: "USD", settlementNet: "50.000000", distinctOrders: 1, lineCount: 1,
      costTotalConverted: null, fxRate: null, netProfit: null, typeBreakdown: {},
      costCurrency: null, purchaseCost: null, freightCost: null, otherCost: null, costTotalOriginal: null,
      netMargin: null, status: "NO_COST" as const, note: null },
  ] as never;
  const result = recomputeSkuProfitWithKernel(scope, rows);
  assert.equal(result.expression, "[principal]-[procurementCost]");
  const a = result.rows.find((r: { sku: string }) => r.sku === "A")!;
  const b = result.rows.find((r: { sku: string }) => r.sku === "B")!;
  assert.equal(a.status, "READY");
  assert.equal(a.netProfit, "40.000000"); // 100 - 60，BigInt 定点
  assert.equal((a as { agreesWithPage: boolean }).agreesWithPage, true);
  assert.equal(b.status, "INCOMPLETE");
  assert.equal(b.netProfit, null); // 缺成本不补零
  assert.ok((b.pendingSources as string[]).includes("procurementCost"));
  assert.equal(result.incompletCount, 1);
  // 报告03：8 维口径覆盖审计存在，且不改变权威净利表达式（不回归）
  const cov = (result as { formulaCoverage: { standardDimensions: { key: string; hasSource: boolean }[]; totalCount: number; coverage: string } }).formulaCoverage;
  assert.ok(cov, "应输出 formulaCoverage");
  assert.equal(cov.totalCount, 8);
  assert.equal(cov.standardDimensions.length, 8);
  assert.equal(result.expression, "[principal]-[procurementCost]", "权威表达式保持 2 项不变");
  // 不臆造红线：无真实来源的维度标 false，不得因增强而被补零纳入计算
  for (const key of ["fbaFee", "adsCost", "returns", "vat"]) {
    assert.equal(cov.standardDimensions.find((d) => d.key === key)!.hasSource, false, `${key} 无来源不得标 present`);
  }
  assert.equal(a.netProfit, "40.000000", "覆盖度增强后权威净利不回归");
});
