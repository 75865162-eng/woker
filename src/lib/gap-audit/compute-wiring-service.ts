/**
 * P4-B 计算服务化接线 service。
 *
 * 把 P1/P2/P3 计算内核接到带租户上下文的服务入口：
 *  - B1 rebuildBalanceProjection → FinanceBalanceProjection（真实账套数据重建 + 幂等落库）
 *  - B4 profit-config            → ProfitConfig / ProfitConfigCountry（CRUD + 版本）
 *  - C6 live-profit              → applyProfitEvents（增量、幂等、跨币种拒绝）
 *  - C1 consolidation            → consolidate（多币种合并报表计算）
 *  - C3 finance-anomaly          → detectFinanceAnomalies（异常检测）
 *  - B5 fx-entry                 → checkFxEntries（外币分录三栏校验钩子）
 *
 * 红线：租户隔离、幂等、不臆造（缺值 INCOMPLETE/NEEDS_DATA）、不自动过账、
 *       BigInt 6 位定点、跨币种不混算。纯计算内核不持久化业务事实。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { scoped } from "@/lib/wms/access";
import { WmsError, type WmsScope } from "@/lib/wms/contracts";
import { requireText } from "@/lib/wms/rules";
import {
  rebuildBalanceProjection as rebuildBalanceProjectionKernel, type BalanceProjectionInput,
  type ProjectionOpening, type ProjectionVoucher,
} from "@/lib/finance/balance-projection";
import {
  buildProfitConfig, resolveProfitConfig, effectiveProfitParams,
  type ProfitConfigRecord, type ProfitConfigValues,
  validateParam,
} from "@/lib/sellfox/profit-config";
import { emptyProfitState, applyProfitEvents, type ProfitEvent } from "@/lib/finance/live-profit";
import { computeProfit, type ProfitItem } from "@/lib/finance/profit-formula";
import type { SkuFinalProfitRow } from "@/lib/amazon-sync/sku-profit-final";
import { consolidate, type EntityBalance, type FxQuote, type Intercompany } from "@/lib/finance/consolidation";
import { detectFinanceAnomalies, type CostObservation, type FeeObservation, type Thresholds } from "@/lib/finance/finance-anomaly";
import { checkFxEntries, type FxEntry } from "@/lib/finance/fx-entry";

const MAX_ROWS = 2000;
function requireScope(scope: WmsScope): void {
  if (!scope?.organizationId || !scope?.workspaceId) throw new WmsError("租户上下文缺失。", 403);
}
function dec(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

// ---------------------------------------------------------------------------
// B1 账本余额投影：从真实账套数据重建，幂等落库
// ---------------------------------------------------------------------------

export async function queryBalanceProjections(scope: WmsScope, params: URLSearchParams) {
  requireScope(scope);
  const bookId = requireText(params.get("bookId"), "账套 ID");
  const periodId = params.get("periodId");
  const rows = await prisma.financeBalanceProjection.findMany({
    where: { ...scoped(scope), bookId, ...(periodId ? { periodId } : {}) },
    orderBy: [{ periodId: "asc" }, { revision: "desc" }, { subjectId: "asc" }], take: MAX_ROWS,
  });
  const latest = rows.length ? Math.max(...rows.map((r) => r.revision)) : 0;
  return {
    revision: latest,
    rows: rows.filter((r) => r.revision === latest || periodId).map((r) => ({
      ...r,
      openingSigned: r.openingSigned.toFixed(6), debit: r.debit.toFixed(6),
      credit: r.credit.toFixed(6), closingSigned: r.closingSigned.toFixed(6),
    })),
    count: rows.length,
  };
}

/**
 * 从账套真实数据重建余额投影。只读账本、只写投影表，绝不写/改凭证（不自动过账）。
 * 幂等：sourceHash 一致时复用现有 revision，skip 落库。
 */
export async function rebuildBalanceProjection(
  scope: WmsScope,
  input: { bookId: string; periodId: string },
) {
  requireScope(scope);
  const bookId = requireText(input.bookId, "账套 ID");
  const periodId = requireText(input.periodId, "期间 ID");
  return prisma.$transaction(async (tx) => {
    const periodRow = await tx.financePeriod.findFirst({
      where: { ...scoped(scope), id: periodId, bookId, book: { enabled: true } }, include: { book: true },
    });
    if (!periodRow) throw new WmsError("会计期间不存在或不属于当前账套。", 404);
    const currency = periodRow.book.currency;

    const [subjects, openingRows, voucherRows, existing] = await Promise.all([
      tx.financeSubject.findMany({ where: { ...scoped(scope), bookId }, select: { id: true } }),
      tx.financeOpeningBalance.findMany({ where: { ...scoped(scope), bookId, periodId } }),
      tx.financeVoucher.findMany({
        where: { ...scoped(scope), bookId, periodId, status: "POSTED" },
        include: { lines: { orderBy: { lineNumber: "asc" } } },
      }),
      tx.financeBalanceProjection.findFirst({
        where: { ...scoped(scope), bookId, periodId }, orderBy: { revision: "desc" },
      }),
    ]);

    const opening: ProjectionOpening[] = openingRows.map((o) => ({
      accountId: o.subjectId, amount: o.amount.toFixed(6), side: o.side as "DEBIT" | "CREDIT",
    }));
    const vouchers: ProjectionVoucher[] = voucherRows.map((v) => ({
      id: v.id, sourceKey: v.sourceKey, status: "POSTED",
      lines: v.lines.map((l) => ({
        accountId: l.subjectId,
        debit: l.debit.toFixed(6), credit: l.credit.toFixed(6),
      })),
    }));
    const projectionInput: BalanceProjectionInput = {
      organizationId: scope.organizationId, workspaceId: scope.workspaceId,
      bookId, currency, periodId, opening, vouchers,
      baseRevision: existing?.revision ?? 0,
      knownSubjectIds: subjects.map((s) => s.id),
    };
    const projection = rebuildBalanceProjectionKernel(projectionInput);

    // 幂等：hash 一致且已有同 revision 数据 → 跳过
    const sameHash = existing && existing.sourceHash === projection.sourceHash;
    if (sameHash) return { reused: true, revision: projection.revision, sourceHash: projection.sourceHash, rows: projection.rows.length };

    let written = 0;
    for (const row of projection.rows) {
      await tx.financeBalanceProjection.upsert({
        where: {
          organizationId_workspaceId_bookId_periodId_revision_subjectId: {
            organizationId: scope.organizationId, workspaceId: scope.workspaceId,
            bookId, periodId, revision: projection.revision, subjectId: row.accountId,
          },
        },
        create: {
          id: crypto.randomUUID(), ...scoped(scope), bookId, periodId, subjectId: row.accountId,
          openingSigned: dec(row.openingSigned), debit: dec(row.debit), credit: dec(row.credit),
          closingSigned: dec(row.closingSigned), revision: projection.revision,
          sourceHash: projection.sourceHash, balanced: true,
        },
        update: {
          openingSigned: dec(row.openingSigned), debit: dec(row.debit), credit: dec(row.credit),
          closingSigned: dec(row.closingSigned), sourceHash: projection.sourceHash, balanced: true,
        },
      });
      written += 1;
    }
    return { reused: false, revision: projection.revision, sourceHash: projection.sourceHash, rows: written };
  });
}

// ---------------------------------------------------------------------------
// B4 利润参数配置 CRUD
// ---------------------------------------------------------------------------

export async function queryProfitConfig(scope: WmsScope, params: URLSearchParams) {
  requireScope(scope);
  const shopId = params.get("shopId");
  const configs = await prisma.profitConfig.findMany({
    where: { ...scoped(scope), ...(shopId ? { shopId } : {}) },
    orderBy: [{ shopId: "asc" }, { version: "desc" }], take: MAX_ROWS,
  });
  if (!configs.length) return { configs: [], countries: [] };
  const ids = configs.map((c) => c.id);
  const countries = await prisma.profitConfigCountry.findMany({
    where: { ...scoped(scope), configId: { in: ids } }, take: MAX_ROWS,
  });
  return {
    configs,
    countries: countries.map((c) => ({
      ...c,
      params: c.params as unknown as ProfitConfigValues,
    })),
  };
}

export async function mutateProfitConfig(scope: WmsScope, body: Record<string, unknown>) {
  requireScope(scope);
  const action = requireText(body.action, "配置动作");
  if (!["create", "review"].includes(action)) throw new WmsError("配置动作不支持。", 400);

  return prisma.$transaction(async (tx) => {
    if (action === "create") {
      const shopId = requireText(body.shopId, "店铺 ID");
      const country = requireText(body.country, "国家码");
      const version = Number(body.version ?? 1);
      const values = (body.values ?? {}) as ProfitConfigValues;
      // 逐参数校验（比率 [0,1]、非负、枚举），缺值保持 null
      for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined) validateParam(key as never, value);
      const record: ProfitConfigRecord = buildProfitConfig({
        organizationId: scope.organizationId, workspaceId: scope.workspaceId,
        shopId, country, isDefault: Boolean(body.isDefault ?? false), version, values,
        changeReference: requireText(body.changeReference, "变更依据", 500),
      });
      const config = await tx.profitConfig.upsert({
        where: {
          organizationId_workspaceId_changeKey: {
            organizationId: scope.organizationId, workspaceId: scope.workspaceId, changeKey: record.changeKey,
          },
        },
        create: {
          id: crypto.randomUUID(), ...scoped(scope), shopId, isDefault: record.isDefault,
          version: record.version, changeReference: record.changeReference, changeKey: record.changeKey,
        },
        update: {},
      });
      await tx.profitConfigCountry.upsert({
        where: {
          organizationId_workspaceId_configId_country: {
            organizationId: scope.organizationId, workspaceId: scope.workspaceId, configId: config.id, country,
          },
        },
        create: {
          id: crypto.randomUUID(), ...scoped(scope), configId: config.id, country,
          params: record.values as unknown as Prisma.InputJsonValue,
          configuredKeys: record.configuredKeys as string[], missingKeys: record.missingKeys as string[],
          effectiveFrom: (body.effectiveFrom as string) ?? null,
        },
        update: {
          params: record.values as unknown as Prisma.InputJsonValue,
          configuredKeys: record.configuredKeys as string[], missingKeys: record.missingKeys as string[],
        },
      });
      await tx.auditLog.create({ data: {
        organizationId: scope.organizationId, userId: scope.actorUserId,
        action: "finance.profit-config.create", entityType: "ProfitConfig", entityId: config.id,
        metadata: { workspaceId: scope.workspaceId, shopId, country, version },
      } });
      return { config, configuredKeys: record.configuredKeys, missingKeys: record.missingKeys };
    }
    // review：标记生效版本（isDefault）。路由层已用 approve 权限保护；自审约束通过 auditLog 溯源。
    const configId = requireText(body.configId, "配置 ID");
    const config = await tx.profitConfig.findFirst({ where: { ...scoped(scope), id: configId } });
    if (!config) throw new WmsError("配置不存在。", 404);
    const prior = await tx.auditLog.findFirst({
      where: { organizationId: scope.organizationId, entityType: "ProfitConfig", entityId: configId, action: "finance.profit-config.create" },
      orderBy: { createdAt: "desc" },
    });
    if (prior?.userId === scope.actorUserId) throw new WmsError("配置禁止申请人自审。", 403);
    const updated = await tx.profitConfig.update({ where: { id: configId }, data: { isDefault: true } });
    await tx.auditLog.create({ data: {
      organizationId: scope.organizationId, userId: scope.actorUserId,
      action: "finance.profit-config.review", entityType: "ProfitConfig", entityId: configId,
      metadata: { workspaceId: scope.workspaceId },
    } });
    return { config: updated };
  });
}

/** 解析某店铺某国家的生效利润参数（供利润计算消费，缺参保持 null）。 */
export async function resolveEffectiveProfitParams(scope: WmsScope, shopId: string, country: string) {
  requireScope(scope);
  const configRows = await prisma.profitConfig.findMany({ where: { ...scoped(scope), shopId }, take: MAX_ROWS });
  if (!configRows.length) return null;
  const countries = await prisma.profitConfigCountry.findMany({
    where: { ...scoped(scope), configId: { in: configRows.map((c) => c.id) } }, take: MAX_ROWS,
  });
  const records: ProfitConfigRecord[] = countries.map((c) => {
    const parent = configRows.find((r) => r.id === c.configId)!;
    return {
      organizationId: c.organizationId, workspaceId: c.workspaceId,
      shopId: parent.shopId, country: c.country, isDefault: parent.isDefault,
      version: parent.version, values: c.params as unknown as ProfitConfigValues,
      changeReference: parent.changeReference, changeKey: parent.changeKey,
      configuredKeys: c.configuredKeys as ProfitConfigRecord["configuredKeys"],
      missingKeys: c.missingKeys as ProfitConfigRecord["missingKeys"],
    };
  });
  const resolved = resolveProfitConfig(country, records);
  return effectiveProfitParams(resolved, resolveProfitConfig("ALL", records));
}

// ---------------------------------------------------------------------------
// B2 以内核修正 SKU 利润页：用 computeProfit(BigInt 6 位定点) 重算权威净利润
// ---------------------------------------------------------------------------

/**
 * 把 SKU 利润页的现有行喂给 computeProfit 内核重算。
 * - principal = 结算净额（结算币种）；procurementCost = 折算成本（同币种）。
 * - 成本缺失/无汇率时内核返回 INCOMPLETE（netProfit=null），与页面"缺值留空"语义一致。
 * - 其余 6 项无来源 → 不放入 items（内核按默认表达式引用；为避免误判缺项，用仅含 2 项的自定义表达式）。
 * - 返回逐 SKU 的内核口径，供页面作为权威利润列/下钻展示（不改写原行的来源证据）。
 */
export function recomputeSkuProfitWithKernel(
  scope: WmsScope,
  rows: readonly SkuFinalProfitRow[],
) {
  requireScope(scope);
  const expression = "[principal]-[procurementCost]";
  const computed = rows.map((r) => {
    const currency = (r.settlementCurrency ?? "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      return { sku: r.sku, status: "INCOMPLETE" as const, netProfit: null, pendingSources: ["principal", "procurementCost"], reason: "结算币种缺失" };
    }
    const items: ProfitItem[] = [
      {
        key: "principal", label: "结算净额", amount: r.settlementNet ?? null,
        currency, source: `settlement:${r.sku}:${r.distinctOrders}order`,
      },
      {
        key: "procurementCost", label: "折算成本", amount: r.costTotalConverted ?? null,
        currency, source: r.fxRate ? `cost@${r.fxRate}` : "",
      },
    ];
    const result = computeProfit({
      organizationId: scope.organizationId, workspaceId: scope.workspaceId,
      currency, version: 1, expression, items,
    });
    return {
      sku: r.sku,
      status: result.status,
      netProfit: result.netProfit,
      pendingSources: result.pendingSources,
      pageNetProfit: r.netProfit,
      agreesWithPage: result.netProfit === null ? r.netProfit === null : result.netProfit === r.netProfit,
    };
  });
  return {
    basis: "SKU 权威净利润由 computeProfit 内核（BigInt 6 位定点）重算：principal=结算净额，procurementCost=折算成本；缺值 INCOMPLETE 不补零，跨币种拒绝。agreesWithPage 标记与旧口径是否一致。",
    expression,
    rows: computed,
    incompletCount: computed.filter((c) => c.status === "INCOMPLETE").length,
    disagreementCount: computed.filter((c) => !c.agreesWithPage).length,
  };
}

// ---------------------------------------------------------------------------
// C6 实时利润流（增量、幂等、跨币种拒绝）
// ---------------------------------------------------------------------------

export async function queryLiveProfit(scope: WmsScope, params: URLSearchParams) {
  requireScope(scope); void params;
  // 实时利润是内存态纯计算：无持久化状态，返回空状态口径说明（事件由 POST 提供）
  const state = emptyProfitState();
  return {
    basis: "实时利润为增量纯计算：事件按 eventKey 幂等，水位单调，跨币种拒绝，pending 来源未确认前 final=false。",
    empty: { profit: "0.000000", final: true, pendingSources: [], watermark: state.watermark },
  };
}

export async function applyLiveProfitEvents(
  scope: WmsScope,
  input: { currency: string; events: ProfitEvent[]; watermark?: string },
) {
  requireScope(scope);
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new WmsError("币种须为三位大写代码。", 400);
  if (!Array.isArray(input.events) || input.events.length > MAX_ROWS) throw new WmsError(`事件数量须在 0..${MAX_ROWS} 之间。`, 422);
  const state = emptyProfitState(input.watermark ?? "");
  // 无持久化：单次请求内的事件序列计算。幂等/水位在 state 内生效。
  return applyProfitEvents(state, input.events, input.currency);
}

// ---------------------------------------------------------------------------
// C1 多币种合并报表
// ---------------------------------------------------------------------------

export async function queryConsolidation(scope: WmsScope, params: URLSearchParams) {
  requireScope(scope); void params;
  return {
    basis: "合并报表按已复核汇率折算，折算差额计入 OCI；内部往来双边主体/币种/金额一致才抵消，缺汇率返回 NEEDS_DATA。",
    requiredInput: ["reportingCurrency", "entities", "balances", "quotes", "intercompany"],
  };
}

export async function computeConsolidation(scope: WmsScope, body: Record<string, unknown>) {
  requireScope(scope);
  const reportingCurrency = requireText(body.reportingCurrency, "合并币种");
  return consolidate({
    reportingCurrency,
    entities: (body.entities ?? []) as never,
    balances: (body.balances ?? []) as EntityBalance[],
    quotes: (body.quotes ?? []) as FxQuote[],
    intercompany: (body.intercompany ?? []) as Intercompany[],
  });
}

// ---------------------------------------------------------------------------
// C3 财务异常检测
// ---------------------------------------------------------------------------

export async function queryFinanceAnomalies(scope: WmsScope, params: URLSearchParams) {
  requireScope(scope); void params;
  return {
    basis: "异常检测规则：R1 应计费用缺失/无依据、R2 单位成本偏离中位数超阈值、R3 对账缺口；样本不足显式 needsData 不臆造。",
    rules: ["R1_FEE_COMPLETENESS", "R2_COST_OUTLIER", "R3_RECONCILE_GAP"],
  };
}

export async function detectAnomalies(
  scope: WmsScope,
  input: { thresholds: Thresholds; costs: CostObservation[]; fees: FeeObservation[]; reconciliationGaps: { key: string; amount: string; currency: string; evidenceId: string }[] },
) {
  requireScope(scope);
  return detectFinanceAnomalies(input);
}

// ---------------------------------------------------------------------------
// B5 外币分录三栏校验（凭证导入钩子）
// ---------------------------------------------------------------------------

export async function checkVoucherFxEntries(
  scope: WmsScope,
  input: { baseCurrency: string; lines: FxEntry[]; toleranceBp?: number },
) {
  requireScope(scope);
  return checkFxEntries(input.lines, input.baseCurrency, input.toleranceBp ?? 10);
}
