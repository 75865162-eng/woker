/**
 * Amazon 结算 SKU 分摊：业务接入层（DB 读取 → 纯函数计算 → 落库 → 审计）。
 *
 * 边界（与项目既有财务边界一致）：
 *  - 只读取 status=PUBLISHED 的结算报告中 attributionStatus=ATTRIBUTED 的行；
 *    未知归属的行保持隔离，不参与分摊，也不静默丢弃（只做显式只读过滤）。
 *  - STAGED 批次只是本地计算结果，**不会自动过账**、不会创建凭证/往来项。
 *    publish 仅登记「交接引用」并校验引用确实属于当前组织/工作区；
 *    引用是否最终过账由 ERP 总账侧决定（独立事实源）。
 *  - 严格 scope：所有查询与写入都带 organizationId + workspaceId，
 *    并在事务内复核成员权限与工作区存在性。
 *  - 幂等：批次唯一键 (报告, 算法版本, 输入摘要)；重复请求返回 reused，不重复写。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { scoped, json } from "@/lib/wms/access";
import { WmsError, type WmsScope } from "@/lib/wms/contracts";
import { strictKeys, requireText } from "@/lib/wms/rules";
import { assertFinanceAction } from "@/lib/finance/access";
import {
  allocateSettlementToSku,
  type RemainderPolicy,
} from "./settlement-sku-allocation";
import {
  assertBatchIdentity,
  toNormalizedSettlementRows,
  type StoredSettlementRow,
} from "./settlement-allocation-mapping";

/** 本地闭环边界：单批次最多处理的结算行数，超出必须显式分批，绝不静默截断。 */
export const settlementAllocationRowLimit = 5000;

const lineSelect = {
  id: true,
  allocationId: true,
  sku: true,
  sellerSku: true,
  businessDate: true,
  currency: true,
  basisAmount: true,
  rate: true,
  shareStorageFee: true,
  shareLongStorageFee: true,
  shareAdvSpendFee: true,
  shareCouponRedemptionFee: true,
  shareReserveFee: true,
  shareReimbursementFee: true,
  shareDisposalFee: true,
  shareShopOtherFee: true,
  isRemainderBearer: true,
  dedupeKey: true,
  overlapKey: true,
  classification: true,
  principalRowRefs: true,
  feeRowRefs: true,
  suppressedRowNumbers: true,
  dedupeEvidence: true,
} satisfies Prisma.AmazonSettlementAllocationLineSelect;

function presentAllocation(row: {
  reconciliation: Prisma.JsonValue;
  [key: string]: unknown;
}) {
  return { ...row, reconciliation: row.reconciliation };
}

/** GET：批次列表；带 allocationId 时返回该批次的明细与去重/对账证据。 */
export async function querySettlementAllocations(scope: WmsScope, params: URLSearchParams) {
  const allocationId = params.get("allocationId")?.trim() || "";
  const settlementId = params.get("settlementId")?.trim() || "";
  return prisma.$transaction(async (tx) => {
    await assertFinanceAction(tx, scope, "view");
    const where = {
      ...scoped(scope),
      ...(settlementId ? { settlementId } : {}),
    };
    const allocations = await tx.amazonSettlementAllocation.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 101,
    });
    const lines = allocationId
      ? await tx.amazonSettlementAllocationLine.findMany({
          where: { ...scoped(scope), allocationId },
          select: lineSelect,
          orderBy: [{ sku: "asc" }, { id: "asc" }],
          take: settlementAllocationRowLimit + 1,
        })
      : [];
    return {
      allocations: allocations.slice(0, 100).map(presentAllocation),
      lines: lines.slice(0, settlementAllocationRowLimit),
      limits: { allocations: 100, lines: settlementAllocationRowLimit },
      truncated: {
        allocations: allocations.length > 100,
        lines: lines.length > settlementAllocationRowLimit,
      },
      scope: "PUBLISHED_ATTRIBUTED_SETTLEMENT_ROWS",
    };
  }, { isolationLevel: "RepeatableRead" });
}

function remainderPolicyOf(value: unknown): RemainderPolicy {
  if (value === undefined || value === null || value === "") return "LARGEST_REMAINDER";
  if (value === "LARGEST_REMAINDER" || value === "MAX_PRINCIPAL_SKU") return value;
  throw new WmsError("remainderPolicy 只支持 LARGEST_REMAINDER 或 MAX_PRINCIPAL_SKU。", 400);
}

/**
 * POST stage：从已发布结算报告读取已归属行，调用纯函数计算，落库为 STAGED 批次。
 * 计算失败（跨币种、非法金额、对账不平）由纯函数抛错，事务回滚，不产生半成品。
 */
export async function stageSettlementAllocation(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, [
    "action", "settlementReportId", "settlementId", "currency", "marketplaceId",
    "remainderPolicy", "controlTotal", "evidence",
  ]);
  const settlementReportId = requireText(body.settlementReportId, "结算报告 ID", 200);
  const settlementId = requireText(body.settlementId, "结算号", 120);
  const currency = requireText(body.currency, "币种", 8).toUpperCase();
  const marketplaceId = requireText(body.marketplaceId, "站点 ID", 64);
  const remainderPolicy = remainderPolicyOf(body.remainderPolicy);
  const evidence = requireText(body.evidence, "分摊来源依据", 1000);
  const controlTotal = body.controlTotal === undefined || body.controlTotal === null || body.controlTotal === ""
    ? undefined
    : requireText(body.controlTotal, "结算控制总额", 64);

  return prisma.$transaction(async (tx) => {
    await assertFinanceAction(tx, scope, "create");
    // 同报告的并发 stage 串行检查幂等键，避免唯一约束错误泄漏为失败请求。
    await tx.$queryRaw`SELECT id FROM "AmazonSettlementReport"
      WHERE id=${settlementReportId} AND "organizationId"=${scope.organizationId}
      AND "workspaceId"=${scope.workspaceId} FOR UPDATE`;
    const report = await tx.amazonSettlementReport.findFirst({
      where: { ...scoped(scope), id: settlementReportId, status: "PUBLISHED" },
      select: { id: true, reportId: true },
    });
    if (!report) throw new WmsError("结算报告不存在或尚未发布，不能分摊。", 404);

    const stored = await tx.amazonSettlementRow.findMany({
      where: { ...scoped(scope), reportDocumentId: settlementReportId, attributionStatus: "ATTRIBUTED" },
      orderBy: { rowNumber: "asc" },
      take: settlementAllocationRowLimit + 1,
      select: {
        rowNumber: true, rowHash: true, businessDateRaw: true, businessDate: true,
        orderId: true, sellerSku: true, asin: true, amountOriginal: true,
        currencyCode: true, currencySource: true, currencySourceRowNumber: true,
        transactionType: true, amountType: true, amountDescription: true,
        marketplaceId: true, fields: true,
      },
    });
    if (stored.length > settlementAllocationRowLimit) {
      throw new WmsError(`单批次结算行超过 ${settlementAllocationRowLimit} 行上限，请按结算号分批。`, 422);
    }
    assertBatchIdentity(stored as StoredSettlementRow[], { settlementId, currency, marketplaceId });

    const result = allocateSettlementToSku(toNormalizedSettlementRows(stored as StoredSettlementRow[]), {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      settlementId,
      currency,
      marketplaceId,
      settlementReportId,
      remainderPolicy,
      ...(controlTotal !== undefined ? { controlTotal } : {}),
    });

    // 幂等：同一报告 + 算法版本 + 输入摘要只保留一个批次。
    const existing = await tx.amazonSettlementAllocation.findFirst({
      where: {
        ...scoped(scope),
        settlementReportId,
        algorithmVersion: result.header.algorithmVersion,
        inputDigest: result.header.inputDigest,
      },
      select: { id: true, status: true, requestHash: true },
    });
    if (existing) {
      if (existing.requestHash !== result.header.requestHash) {
        throw new WmsError("相同输入摘要出现了不同的计算请求，请核对算法参数。", 409);
      }
      return { allocationId: existing.id, status: existing.status, reused: true, header: result.header, reconciliation: result.reconciliation };
    }

    const allocationId = crypto.randomUUID();
    await tx.amazonSettlementAllocation.create({
      data: {
        id: allocationId,
        ...scoped(scope),
        settlementReportId,
        settlementId,
        currency,
        basisType: result.header.basisType,
        algorithmVersion: result.header.algorithmVersion,
        remainderPolicy: result.header.remainderPolicy,
        inputDigest: result.header.inputDigest,
        idempotencyKey: result.header.idempotencyKey,
        requestHash: result.header.requestHash,
        reconciliation: json(result.reconciliation),
        evidence,
        status: "STAGED",
        createdBy: scope.actorUserId,
      },
    });
    if (result.lines.length) {
      await tx.amazonSettlementAllocationLine.createMany({
        data: result.lines.map((line) => ({
          id: crypto.randomUUID(),
          ...scoped(scope),
          allocationId,
          sku: line.sku,
          sellerSku: line.sellerSku,
          businessDate: line.businessDate,
          currency: line.currency,
          basisAmount: line.basisAmount,
          rate: line.rate,
          shareStorageFee: line.shareStorageFee,
          shareLongStorageFee: line.shareLongStorageFee,
          shareAdvSpendFee: line.shareAdvSpendFee,
          shareCouponRedemptionFee: line.shareCouponRedemptionFee,
          shareReserveFee: line.shareReserveFee,
          shareReimbursementFee: line.shareReimbursementFee,
          shareDisposalFee: line.shareDisposalFee,
          shareShopOtherFee: line.shareShopOtherFee,
          isRemainderBearer: line.isRemainderBearer,
          dedupeKey: line.dedupeKey,
          overlapKey: line.overlapKey,
          classification: line.classification,
          principalRowRefs: json(line.principalRowRefs),
          feeRowRefs: json(line.feeRowRefs),
          suppressedRowNumbers: json(line.suppressedRowNumbers),
          dedupeEvidence: json(line.dedupeEvidence),
        })),
      });
    }
    await tx.auditLog.create({
      data: {
        id: crypto.randomUUID(),
        organizationId: scope.organizationId,
        userId: scope.actorUserId,
        action: "amazon.settlement-allocation.stage",
        entityType: "AmazonSettlementAllocation",
        entityId: allocationId,
        metadata: json({
          workspaceId: scope.workspaceId,
          settlementReportId,
          settlementId,
          currency,
          marketplaceId,
          algorithmVersion: result.header.algorithmVersion,
          remainderPolicy: result.header.remainderPolicy,
          inputDigest: result.header.inputDigest,
          inputRowCount: result.header.inputRowCount,
          lineCount: result.header.lineCount,
          basisType: result.header.basisType,
          reconciliationOk: result.reconciliation.ok,
          distinctOrderCount: result.reconciliation.distinctOrderCount,
          postingExecuted: false,
        }),
      },
    });
    return {
      allocationId,
      status: "STAGED",
      reused: false,
      header: result.header,
      reconciliation: result.reconciliation,
      dedupeEvidence: result.dedupeEvidence,
    };
  });
}

/**
 * POST publish：显式登记财务交接引用（STAGED → PUBLISHED）。
 * 只校验引用存在且属于当前组织/工作区，**不创建也不修改**任何凭证或往来项。
 */
export async function publishSettlementAllocation(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ["action", "allocationId", "openItemId", "settlementRef", "evidence"]);
  const allocationId = requireText(body.allocationId, "分摊批次 ID", 200);
  const openItemId = body.openItemId === undefined || body.openItemId === null || body.openItemId === ""
    ? null
    : requireText(body.openItemId, "往来项 ID", 200);
  const settlementRef = body.settlementRef === undefined || body.settlementRef === null || body.settlementRef === ""
    ? null
    : requireText(body.settlementRef, "核销记录 ID", 200);
  const evidence = requireText(body.evidence, "交接依据", 1000);
  if (!openItemId && !settlementRef) throw new WmsError("发布交接须提供往来项或核销记录引用。", 400);

  return prisma.$transaction(async (tx) => {
    await assertFinanceAction(tx, scope, "approve");
    const allocation = await tx.amazonSettlementAllocation.findFirst({
      where: { ...scoped(scope), id: allocationId },
      select: { id: true, status: true, openItemId: true, settlementRef: true },
    });
    if (!allocation) throw new WmsError("分摊批次不存在。", 404);
    if (allocation.status === "REVERSED") throw new WmsError("已冲销的分摊批次不能发布。", 409);
    if (allocation.status === "PUBLISHED") {
      if (allocation.openItemId !== openItemId || allocation.settlementRef !== settlementRef) {
        throw new WmsError("该批次已发布且交接引用不同，请先冲销后重新生成。", 409);
      }
      return { allocationId, status: "PUBLISHED", reused: true };
    }
    if (openItemId) {
      const item = await tx.financeOpenItem.findFirst({
        where: { ...scoped(scope), id: openItemId }, select: { id: true },
      });
      if (!item) throw new WmsError("交接的往来项不存在或不属于当前工作区。", 422);
    }
    if (settlementRef) {
      const row = await tx.financeSettlement.findFirst({
        where: { ...scoped(scope), id: settlementRef }, select: { id: true },
      });
      if (!row) throw new WmsError("交接的核销记录不存在或不属于当前工作区。", 422);
    }
    const updated = await tx.amazonSettlementAllocation.updateMany({
      where: { ...scoped(scope), id: allocationId, status: "STAGED" },
      data: { status: "PUBLISHED", openItemId, settlementRef },
    });
    if (updated.count !== 1) throw new WmsError("分摊批次状态已变化，请刷新后重试。", 409);
    await tx.auditLog.create({
      data: {
        id: crypto.randomUUID(),
        organizationId: scope.organizationId,
        userId: scope.actorUserId,
        action: "amazon.settlement-allocation.publish",
        entityType: "AmazonSettlementAllocation",
        entityId: allocationId,
        metadata: json({ workspaceId: scope.workspaceId, openItemId, settlementRef, evidence, postingExecuted: false }),
      },
    });
    return { allocationId, status: "PUBLISHED", reused: false };
  });
}

/** POST reverse：冲销批次并保留凭据；不删除明细，保证可追溯。 */
export async function reverseSettlementAllocation(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ["action", "allocationId", "evidence"]);
  const allocationId = requireText(body.allocationId, "分摊批次 ID", 200);
  const evidence = requireText(body.evidence, "冲销依据", 1000);
  return prisma.$transaction(async (tx) => {
    await assertFinanceAction(tx, scope, "approve");
    const allocation = await tx.amazonSettlementAllocation.findFirst({
      where: { ...scoped(scope), id: allocationId }, select: { id: true, status: true },
    });
    if (!allocation) throw new WmsError("分摊批次不存在。", 404);
    if (allocation.status === "REVERSED") return { allocationId, status: "REVERSED", reused: true };
    const updated = await tx.amazonSettlementAllocation.updateMany({
      where: { ...scoped(scope), id: allocationId, status: { in: ["STAGED", "PUBLISHED"] } },
      data: { status: "REVERSED", reversedBy: scope.actorUserId, reversedAt: new Date(), reversalEvidence: evidence },
    });
    if (updated.count !== 1) throw new WmsError("分摊批次状态已变化，请刷新后重试。", 409);
    await tx.auditLog.create({
      data: {
        id: crypto.randomUUID(),
        organizationId: scope.organizationId,
        userId: scope.actorUserId,
        action: "amazon.settlement-allocation.reverse",
        entityType: "AmazonSettlementAllocation",
        entityId: allocationId,
        metadata: json({ workspaceId: scope.workspaceId, previousStatus: allocation.status, evidence, postingExecuted: false }),
      },
    });
    return { allocationId, status: "REVERSED", reused: false };
  });
}
