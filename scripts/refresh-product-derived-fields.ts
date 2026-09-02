import { prisma } from "@/lib/db/prisma";
import { pruneExpiredProductListResponseCaches } from "@/lib/products/product-list-cache";
import { refreshProductListSummaryBundle } from "@/lib/products/product-list-summary";

async function refreshDerivedFields() {
  const updated = await prisma.$executeRaw`
    UPDATE "ProductRecord"
    SET
      "source" = CASE
        WHEN "source" = 'sellfox'
          OR "id" ILIKE 'sellfox-%'
          OR COALESCE("payload"->>'note', '') ILIKE '%赛狐在线产品 API%'
        THEN 'sellfox'
        ELSE 'dashboard'
      END,
      "currentOwner" = CASE
        WHEN "status" = 'ops_review' THEN COALESCE(NULLIF("opsAssignee", ''), '')
        WHEN "status" IN ('design_in_progress', 'listing_confirming') THEN COALESCE(NULLIF("designerAssignee", ''), '')
        ELSE COALESCE(NULLIF("selectionOwner", ''), COALESCE("payload"->>'developer', ''))
      END,
      "isOverdue" = CASE
        WHEN "status" IN ('listed', 'canceled', 'delisted', 'patent_risk') THEN false
        WHEN "workflowDueAt" IS NULL THEN false
        ELSE "workflowDueAt" < NOW()
      END
  `;

  return typeof updated === "bigint" ? Number(updated) : Number(updated);
}

async function refreshSummaries() {
  const scopes = await prisma.productRecord.findMany({
    distinct: ["organizationId", "workspaceId"],
    select: {
      organizationId: true,
      workspaceId: true,
    },
    orderBy: [
      {
        organizationId: "asc",
      },
      {
        workspaceId: "asc",
      },
    ],
  });

  for (const scope of scopes) {
    await refreshProductListSummaryBundle(scope);
  }

  return scopes.length;
}

async function main() {
  const startedAt = performance.now();
  const updatedProducts = await refreshDerivedFields();
  const refreshedScopes = await refreshSummaries();
  await pruneExpiredProductListResponseCaches();
  const durationMs = Math.round(performance.now() - startedAt);

  console.log(
    `[products] refreshed derived fields for ${updatedProducts.toLocaleString("zh-CN")} records and rebuilt ${refreshedScopes.toLocaleString("zh-CN")} summary scopes in ${durationMs}ms`,
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown product derived field refresh error.";
    console.error("[products] derived field refresh failed:", message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
