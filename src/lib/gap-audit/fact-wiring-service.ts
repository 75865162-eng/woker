/**
 * P4-A 事实层落库接线 service。
 *
 * 把 P0 纯函数内核接到真实的读写入口：
 *  - A2 buildSalesDailyFacts       → SalesDailyFact（物化 → 回读）
 *  - A3 order-finance-event 内核    → OrderFinanceEvent + BusinessLink
 *  - A4 account-mapping 内核        → FinanceAccountMapping（CRUD + 冲突校验 + 复核）
 *  - A5 reconcile-monthly 内核      → FinanceSupplierReconcile / FinanceCarrierReconcile
 *  - A6 fee-category 字典           → FeeCategoryDict（CRUD）
 *
 * 架构红线：租户隔离、按唯一键幂等 upsert、不臆造（无币种不纳入/缺值 null/跨币种不混算）、
 *          不自动过账（本文件不写任何凭证）、fail-closed（非法输入抛 WmsError → 4xx）。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { scoped } from "@/lib/wms/access";
import { WmsError, type WmsScope } from "@/lib/wms/contracts";
import { requireText } from "@/lib/wms/rules";
import { buildSalesDailyFacts, SALES_DAILY_FACT_BASIS, type SalesFactLine } from "@/lib/amazon-sync/sales-daily-fact";
import {
  classifyFinanceEvent, financeEventEconomicKey, buildOrderFinanceEventRow,
  businessLinkKey, type FinanceEventIdentity,
} from "@/lib/amazon-sync/order-finance-event";
import {
  buildMonthlyReconcile, classifyCounterparty,
  type OpenItemInput, type SettlementInput,
} from "@/lib/finance/reconcile-monthly";
import {
  assertNoMappingConflicts, createMapping, resolveAccounts,
  type AccountMapping,
} from "@/lib/finance/account-mapping";

const MAX_ROWS = 2000;

function dec(value: string | number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  try { return new Prisma.Decimal(String(value)); } catch { return null; }
}
function intOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function requireScope(scope: WmsScope): void {
  if (!scope?.organizationId || !scope?.workspaceId) throw new WmsError("租户上下文缺失。", 403);
}

// ---------------------------------------------------------------------------
// A2 销售日事实
// ---------------------------------------------------------------------------

export type MaterializeSalesFactsInput = {
  sellerAccountId: string;
  marketplaceId: string;
  lines: SalesFactLine[];
  sourceRunId?: string;
};

export async function materializeSalesDailyFacts(scope: WmsScope, input: MaterializeSalesFactsInput) {
  requireScope(scope);
  const sellerAccountId = requireText(input.sellerAccountId, "卖家账户 ID");
  const marketplaceId = requireText(input.marketplaceId, "站点 ID");
  if (!Array.isArray(input.lines) || input.lines.length > MAX_ROWS) {
    throw new WmsError(`销售行数量须在 0..${MAX_ROWS} 之间。`, 422);
  }
  const facts = buildSalesDailyFacts(input.lines);
  const sourceRunId = input.sourceRunId ?? null;
  return prisma.$transaction(async (tx) => {
    let written = 0;
    for (const f of facts) {
      const skuKey = f.sellerSku ?? ""; // 缺 SKU 用空串归一化，保持"缺 SKU 也按日期+币种聚合"
      await tx.salesDailyFact.upsert({
        where: {
          organizationId_workspaceId_sellerAccountId_marketplaceId_sellerSku_businessDate_currency: {
            organizationId: scope.organizationId, workspaceId: scope.workspaceId,
            sellerAccountId, marketplaceId, sellerSku: skuKey, businessDate: f.businessDate, currency: f.currency,
          },
        },
        create: {
          id: crypto.randomUUID(), ...scoped(scope), sellerAccountId, marketplaceId,
          sellerSku: skuKey, asin: f.asin, businessDate: f.businessDate, currency: f.currency,
          unitsOrdered: intOrNull(f.unitsOrdered), orderCount: f.orderCount,
          grossSales: new Prisma.Decimal(f.grossSales),
          refundUnits: intOrNull(f.refundUnits), refundAmount: new Prisma.Decimal(f.refundAmount),
          sourceRunId,
        },
        update: {
          asin: f.asin, unitsOrdered: intOrNull(f.unitsOrdered), orderCount: f.orderCount,
          grossSales: new Prisma.Decimal(f.grossSales),
          refundUnits: intOrNull(f.refundUnits), refundAmount: new Prisma.Decimal(f.refundAmount),
          sourceRunId,
        },
      });
      written += 1;
    }
    return { written, basis: SALES_DAILY_FACT_BASIS };
  });
}

export async function querySalesDailyFacts(scope: WmsScope, params: URLSearchParams) {
  requireScope(scope);
  const sellerSku = params.get("sellerSku");
  const from = params.get("from");
  const to = params.get("to");
  const where: Prisma.SalesDailyFactWhereInput = {
    ...scoped(scope),
    ...(sellerSku ? { sellerSku } : {}),
    ...(from || to ? { businessDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const rows = await prisma.salesDailyFact.findMany({
    where, orderBy: [{ businessDate: "asc" }, { sellerSku: "asc" }, { currency: "asc" }], take: MAX_ROWS,
  });
  return {
    basis: SALES_DAILY_FACT_BASIS,
    rows: rows.map((r) => ({
      ...r,
      grossSales: r.grossSales?.toFixed(6) ?? null,
      refundAmount: r.refundAmount?.toFixed(6) ?? null,
    })),
    count: rows.length,
  };
}

// ---------------------------------------------------------------------------
// A3 订单财务事件 + 业务链路主键
// ---------------------------------------------------------------------------

type FinanceEventSource = {
  transactionId: string;
  amazonOrderId: string;
  orderItemId?: string | null;
  sku?: string | null;
  eventType: string;
  amount: string;
  currency: string;
  postedDate?: string | null;
  marketplaceId?: string | null;
};

export async function materializeOrderFinanceEvents(
  scope: WmsScope,
  params: { sourceRunId?: string; rows: FinanceEventSource[] },
) {
  requireScope(scope);
  if (!Array.isArray(params.rows) || params.rows.length > MAX_ROWS) {
    throw new WmsError(`财务事件行数量须在 0..${MAX_ROWS} 之间。`, 422);
  }
  const sourceRunId = params.sourceRunId ?? null;
  const rows = params.rows.map((r) => {
    const eventType = classifyFinanceEvent(r.eventType);
    const identity: FinanceEventIdentity = {
      organizationId: scope.organizationId, workspaceId: scope.workspaceId,
      amazonOrderId: r.amazonOrderId, orderItemId: r.orderItemId ?? null, sku: r.sku ?? null,
      eventType, currency: r.currency, postedDate: r.postedDate ?? null, sourceRunId,
    };
    // 经济键由权威内核生成（含 eventType/order/item/date/currency），接线层不自行拼装
    return { economicKey: financeEventEconomicKey(identity), row: buildOrderFinanceEventRow(identity, r.amount) };
  });
  // 按内核经济键去重；调用方 transactionId 维度去重在源侧完成
  const unique = new Map<string, typeof rows[number]["row"]>();
  for (const entry of rows) if (!unique.has(entry.economicKey)) unique.set(entry.economicKey, entry.row);
  const kept = [...unique.values()];
  return prisma.$transaction(async (tx) => {
    let events = 0, links = 0;
    for (const e of kept) {
      await tx.orderFinanceEvent.upsert({
        where: {
          organizationId_workspaceId_economicKey: {
            organizationId: scope.organizationId, workspaceId: scope.workspaceId, economicKey: e.economicKey,
          },
        },
        create: {
          id: crypto.randomUUID(), ...scoped(scope),
          economicKey: e.economicKey, amazonOrderId: e.amazonOrderId, orderItemId: e.orderItemId,
          sku: e.sku, ftype: e.ftype, amount: new Prisma.Decimal(e.amount),
          currency: e.currency, postedDate: e.postedDate, sourceRunId: e.sourceRunId,
        },
        update: {
          orderItemId: e.orderItemId, sku: e.sku,
          amount: new Prisma.Decimal(e.amount), postedDate: e.postedDate,
        },
      });
      events += 1;
      const linkKey = businessLinkKey({
        organizationId: scope.organizationId, workspaceId: scope.workspaceId,
        downstreamKind: "FINANCE_EVENT", downstreamId: e.economicKey,
      });
      await tx.businessLink.upsert({
        where: {
          organizationId_workspaceId_linkKey: {
            organizationId: scope.organizationId, workspaceId: scope.workspaceId, linkKey,
          },
        },
        create: {
          id: crypto.randomUUID(), ...scoped(scope), linkKey,
          downstreamKind: "FINANCE_EVENT", downstreamId: e.economicKey,
          amazonOrderId: e.amazonOrderId, orderItemId: e.orderItemId, sourceRunId,
        },
        update: {},
      });
      links += 1;
    }
    return { events, links, deduped: rows.length - kept.length };
  });
}

export async function queryOrderFinanceEvents(scope: WmsScope, params: URLSearchParams) {
  requireScope(scope);
  const amazonOrderId = params.get("amazonOrderId");
  const ftype = params.get("ftype");
  const rows = await prisma.orderFinanceEvent.findMany({
    where: { ...scoped(scope), ...(amazonOrderId ? { amazonOrderId } : {}), ...(ftype ? { ftype } : {}) },
    orderBy: [{ postedDate: "desc" }, { id: "asc" }], take: MAX_ROWS,
  });
  return { rows: rows.map((r) => ({ ...r, amount: r.amount.toFixed(6) })), count: rows.length };
}

// ---------------------------------------------------------------------------
// A4 科目映射主数据
// ---------------------------------------------------------------------------

/** 把 schema 行转成内核 AccountMapping（内核只认 subjectId）。 */
function toAccountMapping(row: {
  organizationId: string; workspaceId: string; bookId: string; feeType: string;
  subjectId: string | null; priority: number; status: string; version: number;
}): AccountMapping | null {
  if (!row.subjectId || (row.status !== "ACTIVE" && row.status !== "INACTIVE")) return null;
  return {
    organizationId: row.organizationId, workspaceId: row.workspaceId, bookId: row.bookId,
    feeType: row.feeType, subjectId: row.subjectId, priority: row.priority,
    status: row.status, version: row.version,
  };
}

export async function queryAccountMappings(scope: WmsScope, params: URLSearchParams) {
  requireScope(scope);
  const bookId = requireText(params.get("bookId"), "账套 ID");
  const rows = await prisma.financeAccountMapping.findMany({
    where: { ...scoped(scope), bookId }, orderBy: [{ feeType: "asc" }, { priority: "desc" }, { version: "desc" }], take: MAX_ROWS,
  });
  return { rows, count: rows.length };
}

export async function mutateAccountMapping(scope: WmsScope, body: Record<string, unknown>) {
  requireScope(scope);
  const action = requireText(body.action, "映射动作");
  if (!["create", "review", "resolve"].includes(action)) throw new WmsError("映射动作不支持。", 400);
  const bookId = requireText(body.bookId, "账套 ID");
  const resolveScope = { organizationId: scope.organizationId, workspaceId: scope.workspaceId, bookId };

  if (action === "resolve") {
    const feeTypes = Array.isArray(body.feeTypes) ? body.feeTypes.map(String) : [requireText(body.feeType, "费用类型")];
    const mappings = await prisma.financeAccountMapping.findMany({
      where: { ...scoped(scope), bookId, feeType: { in: feeTypes }, status: "ACTIVE" },
    });
    const asMappings = mappings.map(toAccountMapping).filter((m): m is AccountMapping => m !== null);
    return resolveAccounts(asMappings, resolveScope, feeTypes);
  }

  return prisma.$transaction(async (tx) => {
    if (!await tx.financeBook.findFirst({ where: { ...scoped(scope), id: bookId, enabled: true } })) {
      throw new WmsError("账套不存在或已停用。", 404);
    }
    if (action === "create") {
      const mapping = createMapping({
        organizationId: scope.organizationId, workspaceId: scope.workspaceId, bookId,
        feeType: requireText(body.feeType, "费用类型"),
        subjectId: requireText(body.subjectId, "目标科目 ID"),
        priority: Number(body.priority ?? 0), status: "INACTIVE", version: Number(body.version ?? 1),
      });
      // 上架前冲突校验：同 feeType+同 priority 多启用项视为冲突
      const active = await tx.financeAccountMapping.findMany({ where: { ...scoped(scope), bookId, feeType: mapping.feeType, status: "ACTIVE" } });
      const activeMappings = active.map(toAccountMapping).filter((m): m is AccountMapping => m !== null);
      assertNoMappingConflicts(activeMappings);
      const created = await tx.financeAccountMapping.create({
        data: {
          id: crypto.randomUUID(), ...scoped(scope), bookId,
          mappingKind: requireText(body.mappingKind, "映射类别"), feeType: mapping.feeType,
          accountId: (body.accountId as string) ?? null, subjectId: mapping.subjectId,
          priority: mapping.priority, status: mapping.status, version: mapping.version,
          changeReference: requireText(body.changeReference, "变更依据", 500),
        },
      });
      await tx.auditLog.create({ data: {
        organizationId: scope.organizationId, userId: scope.actorUserId,
        action: "finance.account-mapping.create", entityType: "FinanceAccountMapping", entityId: created.id,
        metadata: { workspaceId: scope.workspaceId, bookId, feeType: mapping.feeType },
      } });
      return { mapping: created };
    }
    // review → ACTIVE；禁止申请人自审存量 createdBy 场景由账套权限保证
    const mappingId = requireText(body.mappingId, "映射 ID");
    const target = await tx.financeAccountMapping.findFirst({ where: { ...scoped(scope), bookId, id: mappingId } });
    if (!target) throw new WmsError("映射不存在。", 404);
    if (target.status === "ACTIVE") return { mapping: target, reused: true };
    // 复核后需保证无冲突
    const active = await tx.financeAccountMapping.findMany({ where: { ...scoped(scope), bookId, feeType: target.feeType, status: "ACTIVE" } });
    const candidate = toAccountMapping(target);
    if (candidate) assertNoMappingConflicts([...active.map(toAccountMapping).filter((m): m is AccountMapping => m !== null), candidate]);
    const updated = await tx.financeAccountMapping.update({
      where: { id: mappingId }, data: { status: "ACTIVE", reviewedBy: scope.actorUserId },
    });
    await tx.auditLog.create({ data: {
      organizationId: scope.organizationId, userId: scope.actorUserId,
      action: "finance.account-mapping.review", entityType: "FinanceAccountMapping", entityId: mappingId,
      metadata: { workspaceId: scope.workspaceId, bookId },
    } });
    return { mapping: updated };
  });
}

// ---------------------------------------------------------------------------
// A5 供应商/承运商月度对账
// ---------------------------------------------------------------------------

export async function materializeMonthlyReconcile(
  scope: WmsScope,
  params: { bookId: string; reconcileMonth: string; openItems: OpenItemInput[]; settlements: SettlementInput[] },
) {
  requireScope(scope);
  const bookId = requireText(params.bookId, "账套 ID");
  if (!/^\d{4}-\d{2}$/.test(params.reconcileMonth)) throw new WmsError("账期须为 YYYY-MM。", 400);
  if (!await prisma.financeBook.findFirst({ where: { ...scoped(scope), id: bookId } })) throw new WmsError("账套不存在。", 404);
  const results = buildMonthlyReconcile(params.openItems, params.settlements, () => params.reconcileMonth);
  return prisma.$transaction(async (tx) => {
    let written = 0;
    for (const r of results) {
      const kind = classifyCounterparty(r.counterparty);
      if (kind === "unknown") continue; // 未标记对手方不臆造归类
      const amounts = {
        orderCount: r.orderCount,
        totalOrderAmount: dec(r.totalOrderAmount),
        totalPaid: dec(r.totalPaid),
        totalUnpaid: dec(r.totalUnpaid),
      };
      if (kind === "carrier") {
        await tx.financeCarrierReconcile.upsert({
          where: {
            organizationId_workspaceId_bookId_reconcileMonth_carrierId: {
              organizationId: scope.organizationId, workspaceId: scope.workspaceId, bookId,
              reconcileMonth: r.reconcileMonth, carrierId: r.counterparty,
            },
          },
          create: { id: crypto.randomUUID(), ...scoped(scope), bookId, reconcileMonth: r.reconcileMonth, carrierId: r.counterparty, currency: r.currency, ...amounts },
          update: { currency: r.currency, ...amounts },
        });
      } else {
        await tx.financeSupplierReconcile.upsert({
          where: {
            organizationId_workspaceId_bookId_reconcileMonth_supplierId: {
              organizationId: scope.organizationId, workspaceId: scope.workspaceId, bookId,
              reconcileMonth: r.reconcileMonth, supplierId: r.counterparty,
            },
          },
          create: { id: crypto.randomUUID(), ...scoped(scope), bookId, reconcileMonth: r.reconcileMonth, supplierId: r.counterparty, currency: r.currency, ...amounts },
          update: { currency: r.currency, ...amounts },
        });
      }
      written += 1;
    }
    return { written, groups: results.length };
  });
}

export async function queryMonthlyReconcile(scope: WmsScope, params: URLSearchParams) {
  requireScope(scope);
  const bookId = requireText(params.get("bookId"), "账套 ID");
  const reconcileMonth = requireText(params.get("reconcileMonth"), "账期");
  const [suppliers, carriers] = await Promise.all([
    prisma.financeSupplierReconcile.findMany({ where: { ...scoped(scope), bookId, reconcileMonth }, take: MAX_ROWS }),
    prisma.financeCarrierReconcile.findMany({ where: { ...scoped(scope), bookId, reconcileMonth }, take: MAX_ROWS }),
  ]);
  const fmtRow = (r: { totalOrderAmount: Prisma.Decimal | null; totalPaid: Prisma.Decimal | null; totalUnpaid: Prisma.Decimal | null }) => ({
    ...r,
    totalOrderAmount: r.totalOrderAmount?.toFixed(6) ?? null,
    totalPaid: r.totalPaid?.toFixed(6) ?? null,
    totalUnpaid: r.totalUnpaid?.toFixed(6) ?? null,
  });
  return { suppliers: suppliers.map(fmtRow), carriers: carriers.map(fmtRow) };
}

// ---------------------------------------------------------------------------
// A6 费用分类字典
// ---------------------------------------------------------------------------

export async function queryFeeCategoryDict(scope: WmsScope, params: URLSearchParams) {
  requireScope(scope);
  const rows = await prisma.feeCategoryDict.findMany({
    where: { ...scoped(scope), ...(params.get("feeCategory") ? { feeCategory: params.get("feeCategory")! } : {}) },
    orderBy: [{ transactionType: "asc" }, { priority: "desc" }], take: MAX_ROWS,
  });
  return { rows, count: rows.length };
}

export async function mutateFeeCategoryDict(scope: WmsScope, body: Record<string, unknown>) {
  requireScope(scope);
  const action = requireText(body.action, "字典动作");
  if (action !== "upsert") throw new WmsError("字典动作不支持。", 400);
  const transactionType = String(body.transactionType ?? "*");
  const amountType = String(body.amountType ?? "*");
  const amountDescription = String(body.amountDescription ?? "*");
  const version = Number(body.version ?? 1);
  const data = {
    feeCategory: requireText(body.feeCategory, "费用类别"),
    targetColumn: requireText(body.targetColumn, "目标列"),
    feePoolKey: (body.feePoolKey as string) ?? null,
    priority: Number(body.priority ?? 0), status: "ACTIVE", version,
  };
  const created = await prisma.feeCategoryDict.upsert({
    where: {
      organizationId_workspaceId_transactionType_amountType_amountDescription_version: {
        organizationId: scope.organizationId, workspaceId: scope.workspaceId,
        transactionType, amountType, amountDescription, version,
      },
    },
    create: { id: crypto.randomUUID(), ...scoped(scope), transactionType, amountType, amountDescription, ...data },
    update: data,
  });
  await prisma.auditLog.create({ data: {
    organizationId: scope.organizationId, userId: scope.actorUserId,
    action: "finance.fee-category.upsert", entityType: "FeeCategoryDict", entityId: created.id,
    metadata: { workspaceId: scope.workspaceId, feeCategory: data.feeCategory },
  } });
  return { dict: created };
}
