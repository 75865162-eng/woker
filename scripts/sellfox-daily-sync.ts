import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { defaultSellfoxReportDate, syncSellfoxProductDailySnapshots } from "@/lib/sellfox/product-performance";

async function main() {
  const reportDate = process.env.SELLFOX_SYNC_DATE?.trim() || defaultSellfoxReportDate();
  const scopes = await prisma.sellfoxStore.findMany({ distinct: ["organizationId", "workspaceId"], select: { organizationId: true, workspaceId: true } });

  for (const scope of scopes) {
    const result = await syncSellfoxProductDailySnapshots({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, reportDate });
    console.log(`[sellfox] ${scope.organizationId}/${scope.workspaceId}: ${result.synced} rows for ${reportDate}`);
  }
}

void main().finally(() => prisma.$disconnect());
