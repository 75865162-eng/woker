import { prisma } from "@/lib/db/prisma";
import { repairProductProjections } from "@/lib/products/product-projection-repair";

async function refreshDerivedFields() {
  // Pure derived columns only. Expressions read the same locked row; never replay a stale
  // payload snapshot, change revision, or update business facts from this maintenance job.
  // Whole-database scope is intentional; projection repair below has the same scope.
  const updated = await prisma.$executeRaw`
    UPDATE "ProductRecord"
    SET
      "source" = 'dashboard',
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

async function main() {
  const startedAt = performance.now();
  const updatedProducts = await refreshDerivedFields();
  const projectionRepair = await repairProductProjections();
  const durationMs = Math.round(performance.now() - startedAt);

  console.log(
    `[products] scope=all-organizations/all-workspaces; columns=source,currentOwner,isOverdue; payload/revision unchanged; refreshed derived fields for ${updatedProducts.toLocaleString("zh-CN")} records, ` +
      `repaired ${projectionRepair.repaired.toLocaleString("zh-CN")} projections and rebuilt ` +
      `${projectionRepair.scopes.toLocaleString("zh-CN")} summary scopes in ${durationMs}ms`,
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
