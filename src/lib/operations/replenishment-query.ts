import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess } from "@/lib/amazon-sync/data-access";
import { amazonAccountReadAccess } from "@/lib/amazon-sync/read-account";
import { amazonBusinessData } from "@/lib/amazon-sync/business-data";
import type { SyncScope } from "@/lib/amazon-sync/policy";

/** Reads saved suggestions only; never starts recalculation or upstream requests. */
export async function readReplenishmentPlans(scope: SyncScope, actor: string, params: URLSearchParams) {
  const assignments = await amazonDataAccess(scope, actor);
  const sellerAccounts = await prisma.sellerAccount.findMany({
    where: { ...scope, id: { in: assignments.sellerIds }, status: "active" },
    select: { id: true, displayName: true, accountKey: true, marketplaceCode: true, marketplaceId: true },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
  });
  // Account choices are metadata. Do not read any plan until one account is selected.
  if (!params.has("sellerAccountId") && !params.has("sourceId") && !params.has("sellerAccountIds") && assignments.sellerIds.length > 1) {
    const live = await amazonDataAccess(scope, actor);
    return { rows: [], sellerAccounts: sellerAccounts.filter(row => live.sellerIds.includes(row.id)), accountSelectionRequired: true };
  }
  const access = await amazonAccountReadAccess(scope, actor, params);
  const target = { ...scope, sellerAccountId: access.sellerIds[0], ...(params.get("marketplaceId") ? { marketplaceId: params.get("marketplaceId")! } : {}) };
  const policies = await prisma.amazonReplenishmentPolicy.findMany({ where: target, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 200 });
  const plans = policies.length ? await prisma.amazonReplenishmentPlan.findMany({ where: { ...target, policyId: { in: policies.map(row => row.id) } } }) : [];
  const liveParams = new URLSearchParams(params); liveParams.set("sellerAccountId", target.sellerAccountId);
  await amazonAccountReadAccess(scope, actor, liveParams);
  const live = await amazonDataAccess(scope, actor);
  return {
    rows: policies.filter(policy => {
      const inputs = policy.inputs as { historicalSource?: unknown };
      return inputs?.historicalSource == null;
    }).map(policy => ({
      ...policy, inputs: amazonBusinessData(policy.inputs),
      plan: (() => { const plan = plans.find(row => row.policyId === policy.id); return plan ? { ...plan, inputSnapshot: amazonBusinessData(plan.inputSnapshot), result: amazonBusinessData(plan.result) } : null; })(),
    })),
    sellerAccounts: sellerAccounts.filter(row => live.sellerIds.includes(row.id)), accountSelectionRequired: false,
  };
}
