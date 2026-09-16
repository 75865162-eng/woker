import { prisma } from "@/lib/db/prisma";
import { repairProductProjections as repair } from "@/lib/products/product-projection-repair";

async function main() {
  const startedAt = performance.now();
  const batchSize = Number(process.env.PRODUCT_PROJECTION_REPAIR_BATCH_SIZE) || undefined;
  const result = await repair({ batchSize });
  const durationMs = Math.round(performance.now() - startedAt);
  console.log(
    `[products] projection repair completed: ${result.repaired.toLocaleString("zh-CN")} records, ` +
      `${result.scopes.toLocaleString("zh-CN")} scopes, ${durationMs}ms`,
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown product projection repair error.";
    console.error("[products] projection repair failed:", message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
