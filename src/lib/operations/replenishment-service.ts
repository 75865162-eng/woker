import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { readAmazonProductsForSkus } from "./amazon-products";
import { calculateReplenishment, parseReplenishmentInputs } from "./replenishment";
import { extractHistoricalSales } from "./historical-sales";
import { inventorySnapshotStatus } from "./readiness";

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
      if (!policy.sellerSku.trim()) throw new Error("缺少精确 MSKU。");
      const inputs = parseReplenishmentInputs(policy.inputs);
      let inventorySource: "sellfox_inventory_current" | "AmazonInventorySnapshot" = "AmazonInventorySnapshot";
      let inventory: { available: number | null; inbound: number | null; freshness: string; inventoryRunId: string | null;
        storeId?: string; shopExternalId?: string; msku?: string; capturedAt?: string | null } | undefined;
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      if (inputs.historicalSource) {
        const store = await prisma.sellfoxStore.findFirst({ where: { id: inputs.historicalSource.storeId, organizationId: policy.organizationId, workspaceId: policy.workspaceId } });
        if (!store) throw new Error("历史数据店铺映射已失效。");
        const from = new Date(Date.parse(today) - 28 * 86400000).toISOString().slice(0, 10);
        const history = await prisma.$queryRaw<Array<{ reportDate: string; msku: string; quantity: number | null; complete: boolean }>>`
          SELECT "reportDate", msku, quantity, complete FROM sellfox_sales_daily
          WHERE "organizationId" = ${policy.organizationId} AND "workspaceId" = ${policy.workspaceId}
            AND "storeId" = ${store.id} AND msku = ${policy.sellerSku}
            AND "reportDate" >= ${from} AND "reportDate" < ${today} AND complete = true
        `;
        inputs.salesHistory = extractHistoricalSales(history, policy.sellerSku);
        inputs.sourceNote += `；sellfox_sales_daily（店铺 ${store.id}，complete=true，精确 MSKU；缺日不补零）`;
        inventorySource = "sellfox_inventory_current";
        // Aggregate inventory separately from daily sales to avoid join fan-out.
        const stock = await prisma.$queryRaw<Array<{ available: number | null; inbound: number | null; capturedAt: Date | null }>>`
          SELECT CASE WHEN count(*) = count(quantity) THEN sum(quantity)::integer END AS available,
            CASE WHEN count(*) = count("inTransit") THEN sum("inTransit")::integer END AS inbound,
            min("capturedAt") AS "capturedAt"
          FROM sellfox_inventory_current
          WHERE "organizationId" = ${policy.organizationId} AND "workspaceId" = ${policy.workspaceId}
            AND "storeId" = ${store.id} AND msku = ${policy.sellerSku}
        `;
        inventory = { available: stock[0]?.available ?? null, inbound: stock[0]?.inbound ?? null,
          freshness: inventorySnapshotStatus(stock[0]?.capturedAt ?? null, now), inventoryRunId: null,
          storeId: store.id, shopExternalId: store.externalId, msku: policy.sellerSku, capturedAt: stock[0]?.capturedAt?.toISOString() ?? null };
      } else {
        const rows = await readAmazonProductsForSkus(policy.organizationId, policy.workspaceId, [policy.sellerSku]);
        inventory = rows.find((row) => row.sellerAccountId === policy.sellerAccountId && row.marketplaceId === policy.marketplaceId);
      }
      const result = calculateReplenishment(inputs, { available: inventory?.available ?? null, inbound: inventory?.inbound ?? null, fresh: inventory?.freshness === "FRESH" }, today);
      const data = { organizationId: policy.organizationId, workspaceId: policy.workspaceId, sellerAccountId: policy.sellerAccountId, marketplaceId: policy.marketplaceId,
        sellerSku: policy.sellerSku, policyUpdatedAt: policy.updatedAt, inventoryRunId: inventory?.inventoryRunId ?? null,
        lastError: null, inputSnapshot: { inputs, inventory: inventory ?? null, inventorySource, asOf: today } as unknown as Prisma.InputJsonValue,
        result: { ...result, inventorySource } as unknown as Prisma.InputJsonValue, generatedAt: now, nextCalculationAt: new Date(now.getTime() + 24 * 60 * 60_000) };
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${policy.id}, 1))`;
        const current = await tx.amazonReplenishmentPolicy.findUnique({ where: { id: policy.id } });
        if (!current?.enabled || current.updatedAt.getTime() !== policy.updatedAt.getTime()) return;
        const existing = await tx.amazonReplenishmentPlan.findUnique({ where: { policyId: policy.id }, select: { generatedAt: true, policyUpdatedAt: true } });
        if (existing?.policyUpdatedAt.getTime() === policy.updatedAt.getTime() && existing.generatedAt.getTime() >= now.getTime()) return;
        await tx.amazonReplenishmentPlan.upsert({ where: { policyId: policy.id }, create: { id: randomUUID(), policyId: policy.id, ...data }, update: data });
      });
    } catch {
      const failure = { version: "1", inventorySource: null, status: "NEEDS_DATA", lifecycle: typeof policy.inputs === "object" && policy.inputs !== null && !Array.isArray(policy.inputs) && policy.inputs.lifecycle === "NEW" ? "NEW" : "MATURE", dailyDemand: null, daysOfCover: null, estimatedStockoutDate: null, suggestedQuantity: null, suggestedOrderDate: null, urgency: "UNKNOWN", reasons: ["补货计算失败，请检查参数、数据库及库存快照。"], missingInputs: ["可用计算输入"] };
      const failureData = { organizationId: policy.organizationId, workspaceId: policy.workspaceId, sellerAccountId: policy.sellerAccountId, marketplaceId: policy.marketplaceId, sellerSku: policy.sellerSku, policyUpdatedAt: policy.updatedAt, inventoryRunId: null, inputSnapshot: { inputs: policy.inputs, inventory: null, inventorySource: null } as Prisma.InputJsonValue, lastError: "补货计算失败，请检查参数、数据库及库存快照。", result: failure, generatedAt: now, nextCalculationAt: new Date(now.getTime() + 30 * 60_000) };
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${policy.id}, 1))`;
        const current = await tx.amazonReplenishmentPolicy.findUnique({ where: { id: policy.id } });
        if (!current?.enabled || current.updatedAt.getTime() !== policy.updatedAt.getTime()) return;
        const existing = await tx.amazonReplenishmentPlan.findUnique({ where: { policyId: policy.id }, select: { generatedAt: true, policyUpdatedAt: true } });
        if (existing?.policyUpdatedAt.getTime() === policy.updatedAt.getTime() && existing.generatedAt.getTime() >= now.getTime()) return;
        await tx.amazonReplenishmentPlan.upsert({ where: { policyId: policy.id }, create: { id: randomUUID(), policyId: policy.id, ...failureData }, update: failureData });
      });
    }
  }
}
