/**
 * P4-D 调度与物化编排 service。
 *
 * 把"同步后物化"做成受控、幂等、可审计的编排入口：
 *  - D3 computeAttributionCoverage → AdsAttributionCoverage（广告归因覆盖率采集）
 *  - D4 parseInventoryPlanningRow  → InventoryPlanningSnapshot（库存规划快照采集）
 *  - D5 auditBasisCatalog          → 指标口径审计（只读，暴露给 observability）
 *  - D1/D2 销售事实 / 账本投影物化：复用 A2 / B1 的 service（本文件编排触发）
 *
 * 调度约束：env 开关默认 OFF（显式开启才物化）、best-effort（单项失败不影响编排）、
 *          租户隔离、按唯一键幂等 upsert、缺值不补零、跨币种不混算。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { scoped } from "@/lib/wms/access";
import { WmsError, type WmsScope } from "@/lib/wms/contracts";
import { requireText } from "@/lib/wms/rules";
import {
  computeAttributionCoverage, type AdsAttributionRow, type AttributionWindow,
} from "@/lib/amazon-sync/ads-attribution-coverage";
import {
  parseInventoryPlanningRow, planningCoverageMeets,
} from "@/lib/amazon-sync/inventory-planning-snapshot";
import { auditBasisCatalog, GAP_AUDIT_METRIC_BASES } from "@/lib/metric-basis-catalog";

const MAX_ROWS = 2000;
function requireScope(scope: WmsScope): void {
  if (!scope?.organizationId || !scope?.workspaceId) throw new WmsError("租户上下文缺失。", 403);
}

export function materializationSwitches(env: Record<string, string | undefined> = process.env) {
  const on = (v?: string) => v === "true" || v === "1";
  return {
    adsAttribution: on(env.GAP_AUDIT_ADS_ATTRIBUTION_ENABLED),
    inventoryPlanning: on(env.GAP_AUDIT_INVENTORY_PLANNING_ENABLED),
    allEnabled: on(env.GAP_AUDIT_MATERIALIZATION_ENABLED),
  };
}

// ---------------------------------------------------------------------------
// D3 广告归因覆盖率采集 → AdsAttributionCoverage
// ---------------------------------------------------------------------------

export async function materializeAdsAttributionCoverage(
  scope: WmsScope,
  input: {
    marketplaceId: string; businessDate: string; window: AttributionWindow;
    reportType?: string; sellerAccountId?: string; profileRecordId?: string;
    rows: AdsAttributionRow[]; targetBp?: number;
  },
) {
  requireScope(scope);
  const marketplaceId = requireText(input.marketplaceId, "站点 ID");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)) throw new WmsError("业务日期须为 YYYY-MM-DD。", 400);
  if (!Array.isArray(input.rows) || input.rows.length > MAX_ROWS) throw new WmsError(`归因行数量须在 0..${MAX_ROWS} 之间。`, 422);
  const result = computeAttributionCoverage(input.rows, input.window, input.targetBp ?? 9950);
  const reportType = input.reportType ?? "*";
  await prisma.adsAttributionCoverage.upsert({
    where: {
      organizationId_workspaceId_marketplaceId_reportType_businessDate_window: {
        organizationId: scope.organizationId, workspaceId: scope.workspaceId,
        marketplaceId, reportType, businessDate: input.businessDate, window: result.window,
      },
    },
    create: {
      id: crypto.randomUUID(), ...scoped(scope), marketplaceId, reportType,
      businessDate: input.businessDate, window: result.window,
      sellerAccountId: input.sellerAccountId ?? null, profileRecordId: input.profileRecordId ?? null,
      totalSpend: new Prisma.Decimal(result.totalSpend),
      coveredSpend: new Prisma.Decimal(result.coveredSpend),
      uncoveredSpend: new Prisma.Decimal(result.uncoveredSpend),
      coverageBp: result.coverageBp, meetsTarget: result.meetsTarget,
      uncoveredRows: result.uncoveredRows,
      coveredRowCount: result.coveredRowCount, uncoveredRowCount: result.uncoveredRowCount,
    },
    update: {
      totalSpend: new Prisma.Decimal(result.totalSpend),
      coveredSpend: new Prisma.Decimal(result.coveredSpend),
      uncoveredSpend: new Prisma.Decimal(result.uncoveredSpend),
      coverageBp: result.coverageBp, meetsTarget: result.meetsTarget,
      uncoveredRows: result.uncoveredRows,
      coveredRowCount: result.coveredRowCount, uncoveredRowCount: result.uncoveredRowCount,
    },
  });
  return { ...result, stored: true };
}

// ---------------------------------------------------------------------------
// D4 库存规划快照采集 → InventoryPlanningSnapshot
// ---------------------------------------------------------------------------

export async function materializeInventoryPlanning(
  scope: WmsScope,
  input: {
    marketplaceId: string; sellerSku: string; syncRunId: string;
    sellerAccountId?: string; asin?: string; businessDate?: string;
    raw: Record<string, unknown> | null; minCoverage?: number;
  },
) {
  requireScope(scope);
  const marketplaceId = requireText(input.marketplaceId, "站点 ID");
  const sellerSku = requireText(input.sellerSku, "卖家 SKU");
  const syncRunId = requireText(input.syncRunId, "同步运行 ID");
  const snapshot = parseInventoryPlanningRow(input.raw);
  const meets = planningCoverageMeets(snapshot, input.minCoverage ?? 0.9);
  await prisma.inventoryPlanningSnapshot.upsert({
    where: {
      organizationId_workspaceId_marketplaceId_sellerSku_syncRunId: {
        organizationId: scope.organizationId, workspaceId: scope.workspaceId,
        marketplaceId, sellerSku, syncRunId,
      },
    },
    create: {
      id: crypto.randomUUID(), ...scoped(scope), marketplaceId, sellerSku, syncRunId,
      sellerAccountId: input.sellerAccountId ?? null, asin: input.asin ?? null,
      businessDate: input.businessDate ?? null,
      values: snapshot.values as unknown as Prisma.InputJsonValue,
      coverage: new Prisma.Decimal(snapshot.coverage.toFixed(5)),
      missing: snapshot.missing,
      groupCoverage: snapshot.groupCoverage as unknown as Prisma.InputJsonValue,
    },
    update: {
      sellerAccountId: input.sellerAccountId ?? null, asin: input.asin ?? null,
      businessDate: input.businessDate ?? null,
      values: snapshot.values as unknown as Prisma.InputJsonValue,
      coverage: new Prisma.Decimal(snapshot.coverage.toFixed(5)),
      missing: snapshot.missing,
      groupCoverage: snapshot.groupCoverage as unknown as Prisma.InputJsonValue,
    },
  });
  return { coverage: snapshot.coverage, meetsTarget: meets, captured: snapshot.captured.length, missing: snapshot.missing.length, stored: true };
}

// ---------------------------------------------------------------------------
// D5 指标口径审计（只读）
// ---------------------------------------------------------------------------

export function auditMetricBases() {
  return auditBasisCatalog(GAP_AUDIT_METRIC_BASES);
}

// ---------------------------------------------------------------------------
// D1/D2/D3/D4 统一编排入口：best-effort，单项失败不阻断其它
// ---------------------------------------------------------------------------

export type MaterializationTask =
  | { kind: "ads-attribution"; input: Parameters<typeof materializeAdsAttributionCoverage>[1] }
  | { kind: "inventory-planning"; input: Parameters<typeof materializeInventoryPlanning>[1] };

/**
 * 统一物化编排。env 总开关默认 OFF；每个任务独立 try/catch（best-effort）。
 * 返回逐任务结果，失败项以 { ok:false, error } 显式记录，不静默吞掉。
 */
export async function runMaterializations(
  scope: WmsScope,
  tasks: readonly MaterializationTask[],
  env: Record<string, string | undefined> = process.env,
) {
  requireScope(scope);
  const sw = materializationSwitches(env);
  if (!sw.allEnabled) {
    return { enabled: false, results: [], note: "GAP_AUDIT_MATERIALIZATION_ENABLED 未开启，未执行任何物化。" };
  }
  const results: Array<{ kind: string; ok: boolean; detail?: unknown; error?: string }> = [];
  for (const task of tasks) {
    if (task.kind === "ads-attribution" && !sw.adsAttribution) { results.push({ kind: task.kind, ok: false, error: "ads-attribution 开关未开启" }); continue; }
    if (task.kind === "inventory-planning" && !sw.inventoryPlanning) { results.push({ kind: task.kind, ok: false, error: "inventory-planning 开关未开启" }); continue; }
    try {
      const detail = task.kind === "ads-attribution"
        ? await materializeAdsAttributionCoverage(scope, task.input)
        : await materializeInventoryPlanning(scope, task.input);
      results.push({ kind: task.kind, ok: true, detail });
    } catch (error) {
      console.error(JSON.stringify({ scope: "gap-audit.materialize", kind: task.kind, message: error instanceof Error ? error.message : "unknown" }));
      results.push({ kind: task.kind, ok: false, error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { enabled: true, results };
}
