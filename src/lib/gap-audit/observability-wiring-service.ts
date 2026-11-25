/**
 * P4-D6 缓存/开关可观测接线：复用已有 cache-config，不重复建设。
 * 汇总 P0–P4 各事实/投影/内核表的落库计数与开关状态，供诊断端点使用。
 * 只读、租户隔离、只暴露布尔开关与计数，绝不暴露密钥/DSN/token。
 */
import { prisma } from "@/lib/db/prisma";
import { readCacheConfig } from "@/lib/observability/cache-config";
import { WmsError, type WmsScope } from "@/lib/wms/contracts";
import { scoped } from "@/lib/wms/access";

function requireScope(scope: WmsScope): void {
  if (!scope?.organizationId || !scope?.workspaceId) throw new WmsError("租户上下文缺失。", 403);
}

export async function queryAuditObservability(scope: WmsScope) {
  requireScope(scope);
  const s = scoped(scope);
  const [salesFacts, financeEvents, businessLinks, accountMappings, supplierRec, carrierRec,
    balanceProj, profitConfigs, inventorySnaps, adsCoverage] = await Promise.all([
    prisma.salesDailyFact.count({ where: s }),
    prisma.orderFinanceEvent.count({ where: s }),
    prisma.businessLink.count({ where: s }),
    prisma.financeAccountMapping.count({ where: s }),
    prisma.financeSupplierReconcile.count({ where: s }),
    prisma.financeCarrierReconcile.count({ where: s }),
    prisma.financeBalanceProjection.count({ where: s }),
    prisma.profitConfig.count({ where: s }),
    prisma.inventoryPlanningSnapshot.count({ where: s }),
    prisma.adsAttributionCoverage.count({ where: s }),
  ]);
  return {
    scope: s,
    switches: readCacheConfig(),
    materialized: {
      salesDailyFacts: salesFacts,
      orderFinanceEvents: financeEvents,
      businessLinks,
      accountMappings,
      supplierReconciles: supplierRec,
      carrierReconciles: carrierRec,
      balanceProjections: balanceProj,
      profitConfigs,
      inventoryPlanningSnapshots: inventorySnaps,
      adsAttributionCoverages: adsCoverage,
    },
    generatedAt: new Date().toISOString(),
  };
}
