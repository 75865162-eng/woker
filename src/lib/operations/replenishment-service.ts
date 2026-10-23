import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { readAmazonProductsForSkus } from "./amazon-products";
import { calculateReplenishment, parseReplenishmentInputs } from "./replenishment";
import { extractHistoricalSales } from "./historical-sales";

/** Daily/changed-policy calculations run in the dedicated worker, never on page reads. */
export async function refreshDueReplenishmentPlans(now = new Date()) {
  if (!process.env.DATABASE_URL) return;
  const policies = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT p."id" FROM "AmazonReplenishmentPolicy" p
    LEFT JOIN "AmazonReplenishmentPlan" r ON r."policyId" = p."id"
    WHERE p."enabled" = true AND (r."id" IS NULL OR r."policyUpdatedAt" < p."updatedAt" OR r."nextCalculationAt" <= ${now})
    ORDER BY r."nextCalculationAt" ASC NULLS FIRST LIMIT 50
  `;
  for (const candidate of policies) {
    const policy = await prisma.amazonReplenishmentPolicy.findUnique({ where: { id: candidate.id } });
    if (!policy?.enabled) continue;
    try {
      const inputs = parseReplenishmentInputs(policy.inputs);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      if (inputs.historicalSource) {
        const store = await prisma.sellfoxStore.findFirst({ where: { id: inputs.historicalSource.storeId, organizationId: policy.organizationId, workspaceId: policy.workspaceId } });
        if (!store) throw new Error("历史数据店铺映射已失效。");
        const from = new Date(Date.parse(today) - 28 * 86400000).toISOString().slice(0, 10);
        const history = await prisma.sellfoxProductDailySnapshot.findMany({ where: { organizationId: policy.organizationId, workspaceId: policy.workspaceId, storeId: store.id, msku: policy.sellerSku, reportDate: { gte: from, lt: today } }, select: { reportDate: true, msku: true, payload: true }, take: 100 });
        inputs.salesHistory = extractHistoricalSales(history, policy.sellerSku);
        inputs.sourceNote += `；ERP 已有产品日表现（店铺 ${store.id}，原始 saleNum 件数，仅精确单 MSKU；不认定为净订单量）`;
      }
      const rows = await readAmazonProductsForSkus(policy.organizationId, policy.workspaceId, [policy.sellerSku]);
      const inventory = rows.find((row) => row.sellerAccountId === policy.sellerAccountId && row.marketplaceId === policy.marketplaceId);
      const result = calculateReplenishment(inputs, { available: inventory?.available ?? null, inbound: inventory?.inbound ?? null, fresh: inventory?.freshness === "FRESH" }, today);
      const run = await prisma.amazonSyncRun.findFirst({ where: { organizationId: policy.organizationId, workspaceId: policy.workspaceId, resource: "inventory", status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" }, select: { id: true } });
      const data = { organizationId: policy.organizationId, workspaceId: policy.workspaceId, sellerAccountId: policy.sellerAccountId, marketplaceId: policy.marketplaceId,
        sellerSku: policy.sellerSku, policyUpdatedAt: policy.updatedAt, inventoryRunId: run?.id ?? null,
        lastError: null, inputSnapshot: { inputs, inventory: inventory ?? null, asOf: today } as unknown as Prisma.InputJsonValue,
        result: result as unknown as Prisma.InputJsonValue, generatedAt: now, nextCalculationAt: new Date(now.getTime() + 24 * 60 * 60_000) };
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${policy.id}, 1))`;
        const current = await tx.amazonReplenishmentPolicy.findUnique({ where: { id: policy.id } });
        if (!current?.enabled || current.updatedAt.getTime() !== policy.updatedAt.getTime()) return;
        await tx.amazonReplenishmentPlan.upsert({ where: { policyId: policy.id }, create: { id: randomUUID(), policyId: policy.id, ...data }, update: data });
      });
    } catch {
      const failure = { version: "1", status: "NEEDS_DATA", lifecycle: "MATURE", dailyDemand: null, daysOfCover: null, estimatedStockoutDate: null, suggestedQuantity: null, suggestedOrderDate: null, urgency: "UNKNOWN", reasons: ["补货计算失败，请检查参数、数据库及库存快照。"], missingInputs: ["可用计算输入"] };
      const failureData = { organizationId: policy.organizationId, workspaceId: policy.workspaceId, sellerAccountId: policy.sellerAccountId, marketplaceId: policy.marketplaceId, sellerSku: policy.sellerSku, policyUpdatedAt: policy.updatedAt, inputSnapshot: policy.inputs as Prisma.InputJsonValue, lastError: "补货计算失败，请检查参数、数据库及库存快照。", result: failure, generatedAt: now, nextCalculationAt: new Date(now.getTime() + 30 * 60_000) };
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${policy.id}, 1))`;
        const current = await tx.amazonReplenishmentPolicy.findUnique({ where: { id: policy.id } });
        if (!current?.enabled || current.updatedAt.getTime() !== policy.updatedAt.getTime()) return;
        await tx.amazonReplenishmentPlan.upsert({ where: { policyId: policy.id }, create: { id: randomUUID(), policyId: policy.id, ...failureData }, update: failureData });
      });
    }
  }
}
