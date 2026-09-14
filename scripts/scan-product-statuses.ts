import { prisma } from "@/lib/db/prisma";
import { productStatusValues } from "@/lib/products/status-catalog";

const validStatuses = new Set<string>(productStatusValues);

async function main() {
  const rows = await prisma.productRecord.findMany({
    orderBy: [{ organizationId: "asc" }, { workspaceId: "asc" }, { sku: "asc" }],
    select: {
      id: true,
      organizationId: true,
      workspaceId: true,
      sku: true,
      source: true,
      status: true,
      updatedAt: true,
    },
  });

  const invalid = rows.filter((row) => !validStatuses.has(row.status));
  const counts = new Map<string, number>();
  for (const row of invalid) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }

  console.log(`[products] status scan: ${rows.length.toLocaleString("zh-CN")} records scanned`);
  console.log(`[products] valid statuses: ${productStatusValues.join(", ")}`);
  console.log(`[products] invalid records: ${invalid.length.toLocaleString("zh-CN")}`);

  for (const [status, count] of counts) {
    console.log(`- ${JSON.stringify(status)}: ${count.toLocaleString("zh-CN")}`);
  }

  for (const row of invalid.slice(0, 100)) {
    console.log(JSON.stringify(row));
  }

  if (invalid.length > 100) {
    console.log(`[products] output truncated at 100 invalid records`);
  }

  if (invalid.length > 0) {
    process.exitCode = 2;
  }
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown product status scan error.";
    console.error("[products] status scan failed:", message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
