import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { readAmazonProductsForSkus } from "./amazon-products";
import { calculateReplenishment, parseReplenishmentInputs } from "./replenishment";
import { extractHistoricalSales } from "./historical-sales";
import { buildReplenishmentDemandForecast } from "./replenishment-forecast";
import { readSkuAgingFacts, type SkuAgingFact } from "./aging-source";
import { inventorySnapshotStatus } from "./readiness";
import { assertReplenishmentAccess } from "./replenishment-access";
import { SyncInputError } from "@/lib/amazon-sync/policy";

/** Daily/changed-policy calculations run in the dedicated worker, never on page reads. */
export async function refreshDueReplenishmentPlans(now = new Date()) {
  if (!process.env.DATABASE_URL) return;
  const policies = await prisma.$queryRaw<Array<{ id: string; organizationId: string; workspaceId: string; sellerSku: string }>>`
    SELECT p."id", p."organizationId", p."workspaceId", p."sellerSku" FROM "AmazonReplenishmentPolicy" p
    LEFT JOIN "AmazonReplenishmentPlan" r ON r."policyId" = p."id"
    WHERE p."enabled" = true AND (r."id" IS NULL OR r."policyUpdatedAt" < p."updatedAt" OR r."nextCalculationAt" <= ${now})
    ORDER BY r."nextCalculationAt" ASC NULLS FIRST LIMIT 50
  `;
  // Aging is read once per org/workspace for the whole batch; a missing snapshot never blocks the run.
  const agingByScope = new Map<string, Map<string, SkuAgingFact>>();
  const scopeSkus = new Map<string, { organizationId: string; workspaceId: string; skus: Set<string> }>();
  for (const candidate of policies) {
    if (!candidate.sellerSku?.trim()) continue;
    const key = `${candidate.organizationId}|${candidate.workspaceId}`;
    const bucket = scopeSkus.get(key) ?? { organizationId: candidate.organizationId, workspaceId: candidate.workspaceId, skus: new Set<string>() };
    bucket.skus.add(candidate.sellerSku.trim());
    scopeSkus.set(key, bucket);
  }
  for (const [key, scope] of scopeSkus) {
    try {
      agingByScope.set(key, await readSkuAgingFacts(prisma, { ...scope, skus: [...scope.skus], asOf: now }));
    } catch {
      agingByScope.set(key, new Map());
    }
  }
  for (const candidate of policies) {
    const policy = await prisma.amazonReplenishmentPolicy.findUnique({ where: { id: candidate.id } });
    if (!policy?.enabled) continue;
    try {
      if (!policy.sellerSku.trim()) throw new Error("缺少精确 MSKU。");
      const inputs = parseReplenishmentInputs(policy.inputs);
      await assertReplenishmentAccess(prisma, policy, policy.updatedByUserId, policy.sellerAccountId, policy.marketplaceId, inputs.historicalSource?.storeId);
      let inventorySource: "sellfox_inventory_current" | "AmazonInventorySnapshot" = "AmazonInventorySnapshot";
      let inventory: { available: number | null; inbound: number | null; freshness: string; inventoryRunId: string | null;
        storeId?: string; shopExternalId?: string; msku?: string; capturedAt?: string | null } | undefined;
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      if (inputs.historicalSource) {
        const store = await prisma.sellfoxStore.findFirst({ where: { id: inputs.historicalSource.storeId, organizationId: policy.organizationId, workspaceId: policy.workspaceId } });
        if (!store) throw new Error("历史数据店铺映射已失效。");
        // Mature SKUs read a longer window so the forecast layer can fit weekly
        // seasonality and a trend; the 28-day model is still used when it cannot.
        const historyDays = inputs.lifecycle === "MATURE" ? 180 : 28;
        const from = new Date(Date.parse(today) - historyDays * 86400000).toISOString().slice(0, 10);
        const history = await prisma.$queryRaw<Array<{ reportDate: string; msku: string; quantity: number | null; complete: boolean }>>`
          SELECT "reportDate", msku, quantity, complete FROM sellfox_sales_daily
          WHERE "organizationId" = ${policy.organizationId} AND "workspaceId" = ${policy.workspaceId}
            AND "storeId" = ${store.id} AND msku = ${policy.sellerSku}
            AND "reportDate" >= ${from} AND "reportDate" < ${today} AND complete = true
        `;
        inputs.salesHistory = extractHistoricalSales(history, policy.sellerSku);
        inputs.sourceNote += `；sellfox_sales_daily（店铺 ${store.id}，complete=true，精确 MSKU；缺日不补零）`;
        if (inputs.lifecycle === "MATURE") {
          const leadSum = [inputs.productionDays, inputs.domesticDays, inputs.oceanDays]
            .reduce<number>((sum, value) => sum + (value ?? 0), 0);
          const built = buildReplenishmentDemandForecast({
            salesHistory: inputs.salesHistory,
            asOf: today,
            horizonDays: Math.ceil(leadSum + inputs.safetyDays + inputs.reviewDays),
          });
          inputs.demandForecast = built.forecast;
          inputs.sourceNote = `${inputs.sourceNote.slice(0, 380)}；${built.note}`;
        }
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
        const rows = await readAmazonProductsForSkus(policy.organizationId, policy.workspaceId, [policy.sellerSku], policy.updatedByUserId, { sellerAccountId: policy.sellerAccountId, marketplaceId: policy.marketplaceId });
        inventory = rows.find((row) => row.sellerAccountId === policy.sellerAccountId && row.marketplaceId === policy.marketplaceId);
      }
      const scopeKey = `${policy.organizationId}|${policy.workspaceId}`;
      const aging = agingByScope.get(scopeKey)?.get(policy.sellerSku.trim()) ?? null;
      const result = calculateReplenishment(inputs, { available: inventory?.available ?? null, inbound: inventory?.inbound ?? null, fresh: inventory?.freshness === "FRESH" }, today);
      result.reasons.push(aging ? aging.note : "无 WMS 库龄快照：清仓类广告决策不可用，不推断库龄。");
      const data = { organizationId: policy.organizationId, workspaceId: policy.workspaceId, sellerAccountId: policy.sellerAccountId, marketplaceId: policy.marketplaceId,
        sellerSku: policy.sellerSku, policyUpdatedAt: policy.updatedAt, inventoryRunId: inventory?.inventoryRunId ?? null,
        lastError: null, inputSnapshot: { inputs, inventory: inventory ?? null, inventorySource, aging, asOf: today } as unknown as Prisma.InputJsonValue,
        result: { ...result, inventorySource, agingDays: aging?.agingDays ?? null, agingDataStatus: aging?.dataStatus ?? "ABSENT" } as unknown as Prisma.InputJsonValue, generatedAt: now, nextCalculationAt: new Date(now.getTime() + 24 * 60 * 60_000) };
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${policy.id}, 1))`;
        const current = await tx.amazonReplenishmentPolicy.findUnique({ where: { id: policy.id } });
        if (!current?.enabled || current.updatedAt.getTime() !== policy.updatedAt.getTime()) return;
        await assertReplenishmentAccess(tx, current, current.updatedByUserId, current.sellerAccountId, current.marketplaceId, inputs.historicalSource?.storeId);
        const existing = await tx.amazonReplenishmentPlan.findUnique({ where: { policyId: policy.id }, select: { generatedAt: true, policyUpdatedAt: true } });
        if (existing?.policyUpdatedAt.getTime() === policy.updatedAt.getTime() && existing.generatedAt.getTime() >= now.getTime()) return;
        await tx.amazonReplenishmentPlan.upsert({ where: { policyId: policy.id }, create: { id: randomUUID(), policyId: policy.id, ...data }, update: data });
      });
    } catch (error) {
      // Revocation must not publish a new result, even a failure containing old inputs.
      if (error instanceof SyncInputError && error.status === 403) continue;
      try {
        const inputs = parseReplenishmentInputs(policy.inputs);
        await assertReplenishmentAccess(prisma, policy, policy.updatedByUserId, policy.sellerAccountId, policy.marketplaceId, inputs.historicalSource?.storeId);
      } catch { continue; }
      const failure = { version: "1", inventorySource: null, status: "NEEDS_DATA", lifecycle: typeof policy.inputs === "object" && policy.inputs !== null && !Array.isArray(policy.inputs) && policy.inputs.lifecycle === "NEW" ? "NEW" : "MATURE", dailyDemand: null, daysOfCover: null, estimatedStockoutDate: null, suggestedQuantity: null, suggestedOrderDate: null, urgency: "UNKNOWN", reasons: ["补货计算失败，请检查参数、数据库及库存快照。"], missingInputs: ["可用计算输入"] };
      const failureData = { organizationId: policy.organizationId, workspaceId: policy.workspaceId, sellerAccountId: policy.sellerAccountId, marketplaceId: policy.marketplaceId, sellerSku: policy.sellerSku, policyUpdatedAt: policy.updatedAt, inventoryRunId: null, inputSnapshot: { inputs: policy.inputs, inventory: null, inventorySource: null } as Prisma.InputJsonValue, lastError: "补货计算失败，请检查参数、数据库及库存快照。", result: failure, generatedAt: now, nextCalculationAt: new Date(now.getTime() + 30 * 60_000) };
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${policy.id}, 1))`;
        const current = await tx.amazonReplenishmentPolicy.findUnique({ where: { id: policy.id } });
        if (!current?.enabled || current.updatedAt.getTime() !== policy.updatedAt.getTime()) return;
        try {
          await assertReplenishmentAccess(tx, current, current.updatedByUserId, current.sellerAccountId, current.marketplaceId, parseReplenishmentInputs(current.inputs).historicalSource?.storeId);
        } catch { return; }
        const existing = await tx.amazonReplenishmentPlan.findUnique({ where: { policyId: policy.id }, select: { generatedAt: true, policyUpdatedAt: true } });
        if (existing?.policyUpdatedAt.getTime() === policy.updatedAt.getTime() && existing.generatedAt.getTime() >= now.getTime()) return;
        await tx.amazonReplenishmentPlan.upsert({ where: { policyId: policy.id }, create: { id: randomUUID(), policyId: policy.id, ...failureData }, update: failureData });
      });
    }
  }
}
