import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

type BenchmarkSample = {
  operation: string;
  count: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  payloadBytes?: number;
};

const scales = readScales();
const sampleCount = readPositiveInteger("PRODUCT_BENCHMARK_SAMPLES", 12);
const warmupCount = readPositiveInteger("PRODUCT_BENCHMARK_WARMUPS", 2);
const databaseUrl = requireEnv(
  "PRODUCT_BENCHMARK_DATABASE_URL",
  "Use a dedicated non-production PostgreSQL database.",
);
const organizationId = requireEnv("PRODUCT_BENCHMARK_ORGANIZATION_ID");
const userId = requireEnv("PRODUCT_BENCHMARK_USER_ID");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const listSql = (workspaceId: string, search?: string) => {
  const searchCondition = search
    ? `AND (
        s."sku" ILIKE $3
        OR s."productRecordId" ILIKE $3
        OR s."chineseName" ILIKE $3
        OR s."englishName" ILIKE $3
        OR COALESCE(t."keywords", '') ILIKE $3
      )`
    : "";
  const values = search ? [organizationId, workspaceId, `%${search}%`] : [organizationId, workspaceId];

  return {
    values,
    sql: `
      SELECT
        s."productRecordId" AS "id",
        s."sku",
        s."chineseName",
        s."englishName",
        s."asin",
        s."status",
        s."primaryImageUrl" AS "image",
        COALESCE(t."keywords", '') AS "keywords"
      FROM "ProductSummaryRecord" s
      LEFT JOIN "ProductTextRecord" t
        ON t."productRecordId" = s."productRecordId"
        AND t."organizationId" = s."organizationId"
        AND t."workspaceId" = s."workspaceId"
        AND t."language" = 'default'
        AND t."sourceRevision" = s."sourceRevision"
      WHERE s."organizationId" = $1
        AND s."workspaceId" = $2
        ${searchCondition}
      ORDER BY s."createdAt" DESC, s."sku" ASC
      OFFSET 0
      LIMIT 50
    `,
  };
};

async function main() {
  const results: Array<BenchmarkSample & { scale: number }> = [];
  try {
    for (const scale of scales) {
      const workspaceId = `benchmark-${Date.now()}-${scale}`;
      await seedWorkspace(workspaceId, scale);

      try {
        results.push(
          ...(await benchmarkWorkspace(workspaceId, scale)),
        );
      } finally {
        await cleanupWorkspace(workspaceId);
      }
    }

    console.log(JSON.stringify({
      database: "dedicated benchmark database",
      scales,
      samples: sampleCount,
      warmups: warmupCount,
      results,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

async function seedWorkspace(workspaceId: string, scale: number) {
  const products = Array.from({ length: scale }, (_, index) => {
    const sequence = String(index + 1).padStart(6, "0");
    const productRecordId = `benchmark-${workspaceId}-${sequence}`;
    return {
      id: productRecordId,
      organizationId,
      userId,
      workspaceId,
      sku: `BENCH-${sequence}`,
      payload: {
        id: productRecordId,
        sku: `BENCH-${sequence}`,
        chineseName: `Benchmark product ${sequence}`,
        englishName: `Benchmark product ${sequence}`,
        keywords: `benchmark keyword ${index % 100}`,
        status: "developing",
        images: [],
        imageAssets: [],
      },
      chineseName: `Benchmark product ${sequence}`,
      englishName: `Benchmark product ${sequence}`,
      asin: `B${sequence}`,
      status: "developing",
      source: "dashboard",
      revision: 1,
    };
  });
  const summaries = products.map((product, index) => ({
    productRecordId: product.id,
    organizationId,
    workspaceId,
    sku: product.sku,
    chineseName: product.chineseName,
    englishName: product.englishName,
    asin: product.asin,
    status: product.status,
    source: "dashboard",
    sourceRevision: 1,
    projectionVersion: 1,
    createdAt: new Date(Date.now() - (products.length - index) * 1000),
  }));
  const texts = products.map((product, index) => ({
    productRecordId: product.id,
    organizationId,
    workspaceId,
    language: "default",
    keywords: `benchmark keyword ${index % 100}`,
    sourceRevision: 1,
    projectionVersion: 1,
  }));

  await prisma.productRecord.createMany({ data: products });
  await prisma.productSummaryRecord.createMany({ data: summaries });
  await prisma.productTextRecord.createMany({ data: texts });
}

async function benchmarkWorkspace(workspaceId: string, scale: number) {
  const operations = [
    { name: "list-first-page", run: () => runList(workspaceId) },
    { name: "keyword-search", run: () => runList(workspaceId, "keyword 42") },
    { name: "keyword-count", run: () => runCount(workspaceId, "keyword 42") },
    { name: "detail-source", run: () => runDetail(workspaceId) },
  ];
  const results: Array<BenchmarkSample & { scale: number }> = [];

  for (const operation of operations) {
    for (let index = 0; index < warmupCount; index += 1) {
      await operation.run();
    }

    const durations: number[] = [];
    let payloadBytes: number | undefined;
    for (let index = 0; index < sampleCount; index += 1) {
      const startedAt = performance.now();
      const result = await operation.run();
      durations.push(performance.now() - startedAt);
      if (typeof result === "object" && result !== null && "payloadBytes" in result) {
        payloadBytes = result.payloadBytes;
      }
    }

    results.push({
      scale,
      operation: operation.name,
      count: durations.length,
      p50Ms: round(percentile(durations, 0.5)),
      p95Ms: round(percentile(durations, 0.95)),
      maxMs: round(Math.max(...durations)),
      ...(payloadBytes === undefined ? {} : { payloadBytes }),
    });
  }

  return results;
}

async function runList(workspaceId: string, search?: string) {
  const query = listSql(workspaceId, search);
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(query.sql, ...query.values);
  return { payloadBytes: Buffer.byteLength(JSON.stringify(rows), "utf8") };
}

async function runCount(workspaceId: string, search: string) {
  const query = listSql(workspaceId, search);
  const countSql = query.sql
    .replace(/SELECT[\s\S]*?FROM "ProductSummaryRecord" s/, 'SELECT COUNT(*)::int AS "count" FROM "ProductSummaryRecord" s')
    .replace(/ORDER BY[\s\S]*?LIMIT 50/, "");
  await prisma.$queryRawUnsafe<Array<{ count: number }>>(countSql, ...query.values);
}

async function runDetail(workspaceId: string) {
  const result = await prisma.productRecord.findFirst({
    where: {
      organizationId,
      workspaceId,
    },
    select: {
      id: true,
      sku: true,
      payload: true,
      revision: true,
    },
  });
  return { payloadBytes: Buffer.byteLength(JSON.stringify(result), "utf8") };
}

async function cleanupWorkspace(workspaceId: string) {
  await prisma.productListCacheRecord.deleteMany({ where: { organizationId, workspaceId } });
  await prisma.productOutboxEvent.deleteMany({ where: { organizationId, workspaceId } });
  await prisma.productRecord.deleteMany({ where: { organizationId, workspaceId } });
}

function readScales() {
  const raw = process.env.PRODUCT_BENCHMARK_SCALES ?? "1000,5000,10000";
  const values = raw
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (!values.length) {
    throw new Error("PRODUCT_BENCHMARK_SCALES must contain positive integers.");
  }
  return values;
}

function requireEnv(name: string, suffix = "") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.${suffix ? ` ${suffix}` : ""}`);
  }
  return value;
}

function readPositiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

void main().catch((error) => {
  console.error("[products:benchmark]", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
