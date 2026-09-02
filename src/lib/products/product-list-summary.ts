import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { hasIncompleteOperationsProgress } from "@/lib/products/operations-progress";
import { getProductRecordSource, normalizeProductStatus, type ProductListSource } from "@/lib/products/list-query";
import type { Product, ProductListSummary } from "@/lib/products/types";

type ProductListSummarySource = Partial<Pick<Product, "id" | "note" | "status" | "workflowDueAt" | "createdAt" | "operationsProgress">> & {
  source?: string | null;
};

export type ProductListSummaryBundle = Record<ProductListSource, ProductListSummary>;

const summarySources: ProductListSource[] = ["all", "dashboard", "sellfox"];
const closedStatuses = new Set(["listed", "canceled", "delisted", "patent_risk"]);
const overdueLookbackDays = 8;

function createEmptyProductListSummary(): ProductListSummary {
  return {
    total: 0,
    developing: 0,
    opsReview: 0,
    designInProgress: 0,
    operationsProgress: 0,
    overdue: 0,
  };
}

function createEmptyProductListSummaryBundle(): ProductListSummaryBundle {
  const empty = createEmptyProductListSummary();
  return {
    all: { ...empty },
    dashboard: { ...empty },
    sellfox: { ...empty },
  };
}

function isSellfoxProductRecord(product: Pick<ProductListSummarySource, "id" | "note">) {
  return getProductRecordSource(product) === "sellfox";
}

function isOverdue(product: ProductListSummarySource, status: string, now = new Date()) {
  if (closedStatuses.has(status)) {
    return false;
  }

  const nowTime = now.getTime();
  const workflowDueAt = product.workflowDueAt ? new Date(product.workflowDueAt).getTime() : Number.NaN;
  const createdAt = product.createdAt ? new Date(product.createdAt).getTime() : Number.NaN;

  return (Number.isFinite(workflowDueAt) && workflowDueAt < nowTime) || (Number.isFinite(createdAt) && createdAt < nowTime - overdueLookbackDays * 24 * 60 * 60 * 1000);
}

export function createProductListSummaryContribution(product: ProductListSummarySource | null | undefined, now = new Date()): ProductListSummary {
  if (!product) {
    return createEmptyProductListSummary();
  }

  const status = normalizeProductStatus(product.status ?? "");

  return {
    total: 1,
    developing: status === "developing" ? 1 : 0,
    opsReview: status === "ops_review" ? 1 : 0,
    designInProgress: status === "design_in_progress" ? 1 : 0,
    operationsProgress: hasIncompleteOperationsProgress(product.operationsProgress) ? 1 : 0,
    overdue: isOverdue(product, status, now) ? 1 : 0,
  };
}

export function addProductListSummaries(left: ProductListSummary, right: ProductListSummary): ProductListSummary {
  return {
    total: left.total + right.total,
    developing: left.developing + right.developing,
    opsReview: left.opsReview + right.opsReview,
    designInProgress: left.designInProgress + right.designInProgress,
    operationsProgress: left.operationsProgress + right.operationsProgress,
    overdue: left.overdue + right.overdue,
  };
}

export function subtractProductListSummaries(left: ProductListSummary, right: ProductListSummary): ProductListSummary {
  return {
    total: left.total - right.total,
    developing: left.developing - right.developing,
    opsReview: left.opsReview - right.opsReview,
    designInProgress: left.designInProgress - right.designInProgress,
    operationsProgress: left.operationsProgress - right.operationsProgress,
    overdue: left.overdue - right.overdue,
  };
}

export function getProductListSummarySourceContribution(
  product: ProductListSummarySource | null | undefined,
  source: ProductListSource,
  now = new Date(),
) {
  if (!product) {
    return createEmptyProductListSummary();
  }

  const isSellfox = isSellfoxProductRecord(product);
  if (source === "dashboard" && isSellfox) {
    return createEmptyProductListSummary();
  }
  if (source === "sellfox" && !isSellfox) {
    return createEmptyProductListSummary();
  }

  return createProductListSummaryContribution(product, now);
}

function toSummary(total: number, developing: number, opsReview: number, designInProgress: number, operationsProgress: number, overdue: number): ProductListSummary {
  return {
    total,
    developing,
    opsReview,
    designInProgress,
    operationsProgress,
    overdue,
  };
}

function toNumber(value: unknown) {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

function mapSummaryRecord(record: {
  total: number;
  developing: number;
  opsReview: number;
  designInProgress: number;
  operationsProgress: number;
  overdue: number;
}) {
  return {
    total: record.total,
    developing: record.developing,
    opsReview: record.opsReview,
    designInProgress: record.designInProgress,
    operationsProgress: record.operationsProgress,
    overdue: record.overdue,
  };
}

function toProductListSummaryBundle(rows: Array<{
  source: string;
  total: number;
  developing: number;
  opsReview: number;
  designInProgress: number;
  operationsProgress: number;
  overdue: number;
}>): ProductListSummaryBundle {
  const bundle = createEmptyProductListSummaryBundle();

  for (const row of rows) {
    if (row.source === "all" || row.source === "dashboard" || row.source === "sellfox") {
      const source = row.source as ProductListSource;
      bundle[source] = mapSummaryRecord(row);
    }
  }

  return bundle;
}

async function readProductListSummaryBundleFromTable(input: {
  organizationId: string;
  workspaceId: string;
}): Promise<ProductListSummaryBundle | null> {
  const rows = await prisma.productListSummaryRecord.findMany({
    where: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      source: {
        in: summarySources,
      },
    },
    select: {
      source: true,
      total: true,
      developing: true,
      opsReview: true,
      designInProgress: true,
      operationsProgress: true,
      overdue: true,
    },
  });

  if (rows.length !== summarySources.length) {
    return null;
  }

  return toProductListSummaryBundle(rows);
}

async function rebuildProductListSummaryBundleFromProducts(input: {
  organizationId: string;
  workspaceId: string;
}): Promise<ProductListSummaryBundle> {
  const [row] = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    WITH scoped_products AS (
      SELECT
        status,
        "source",
        "workflowDueAt",
        "createdAt",
        "operationsProgressIncomplete",
        ("source" = 'sellfox') AS is_sellfox
      FROM "ProductRecord"
      WHERE "organizationId" = ${input.organizationId}
        AND "workspaceId" = ${input.workspaceId}
    )
    SELECT
      COUNT(*)::int AS "allTotal",
      COUNT(*) FILTER (WHERE status = 'developing')::int AS "allDeveloping",
      COUNT(*) FILTER (WHERE status = 'ops_review')::int AS "allOpsReview",
      COUNT(*) FILTER (WHERE status = 'design_in_progress')::int AS "allDesignInProgress",
      COUNT(*) FILTER (WHERE "operationsProgressIncomplete" = true)::int AS "allOperationsProgress",
      COUNT(*) FILTER (
        WHERE status NOT IN ('listed', 'canceled', 'delisted', 'patent_risk')
          AND (("workflowDueAt" < NOW()) OR ("createdAt" < NOW() - INTERVAL '8 days'))
      )::int AS "allOverdue",
      COUNT(*) FILTER (WHERE NOT is_sellfox)::int AS "dashboardTotal",
      COUNT(*) FILTER (WHERE NOT is_sellfox AND status = 'developing')::int AS "dashboardDeveloping",
      COUNT(*) FILTER (WHERE NOT is_sellfox AND status = 'ops_review')::int AS "dashboardOpsReview",
      COUNT(*) FILTER (WHERE NOT is_sellfox AND status = 'design_in_progress')::int AS "dashboardDesignInProgress",
      COUNT(*) FILTER (WHERE NOT is_sellfox AND "operationsProgressIncomplete" = true)::int AS "dashboardOperationsProgress",
      COUNT(*) FILTER (
        WHERE NOT is_sellfox
          AND status NOT IN ('listed', 'canceled', 'delisted', 'patent_risk')
          AND (("workflowDueAt" < NOW()) OR ("createdAt" < NOW() - INTERVAL '8 days'))
      )::int AS "dashboardOverdue",
      COUNT(*) FILTER (WHERE is_sellfox)::int AS "sellfoxTotal",
      COUNT(*) FILTER (WHERE is_sellfox AND status = 'developing')::int AS "sellfoxDeveloping",
      COUNT(*) FILTER (WHERE is_sellfox AND status = 'ops_review')::int AS "sellfoxOpsReview",
      COUNT(*) FILTER (WHERE is_sellfox AND status = 'design_in_progress')::int AS "sellfoxDesignInProgress",
      COUNT(*) FILTER (WHERE is_sellfox AND "operationsProgressIncomplete" = true)::int AS "sellfoxOperationsProgress",
      COUNT(*) FILTER (
        WHERE is_sellfox
          AND status NOT IN ('listed', 'canceled', 'delisted', 'patent_risk')
          AND (("workflowDueAt" < NOW()) OR ("createdAt" < NOW() - INTERVAL '8 days'))
      )::int AS "sellfoxOverdue"
    FROM scoped_products
  `);

  return {
    all: toSummary(
      toNumber(row?.allTotal),
      toNumber(row?.allDeveloping),
      toNumber(row?.allOpsReview),
      toNumber(row?.allDesignInProgress),
      toNumber(row?.allOperationsProgress),
      toNumber(row?.allOverdue),
    ),
    dashboard: toSummary(
      toNumber(row?.dashboardTotal),
      toNumber(row?.dashboardDeveloping),
      toNumber(row?.dashboardOpsReview),
      toNumber(row?.dashboardDesignInProgress),
      toNumber(row?.dashboardOperationsProgress),
      toNumber(row?.dashboardOverdue),
    ),
    sellfox: toSummary(
      toNumber(row?.sellfoxTotal),
      toNumber(row?.sellfoxDeveloping),
      toNumber(row?.sellfoxOpsReview),
      toNumber(row?.sellfoxDesignInProgress),
      toNumber(row?.sellfoxOperationsProgress),
      toNumber(row?.sellfoxOverdue),
    ),
  };
}

export async function loadProductListSummaryBundle(input: {
  organizationId: string;
  workspaceId: string;
}): Promise<ProductListSummaryBundle> {
  const cached = await readProductListSummaryBundleFromTable(input);
  if (cached) {
    return cached;
  }

  const rebuilt = await rebuildProductListSummaryBundleFromProducts(input);
  await upsertProductListSummaryBundle(prisma, input, rebuilt);
  return rebuilt;
}

function summaryBundleDelta(input: {
  before?: ProductListSummarySource | null;
  after?: ProductListSummarySource | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return {
    all: subtractProductListSummaries(
      createProductListSummaryContribution(input.after ?? null, now),
      createProductListSummaryContribution(input.before ?? null, now),
    ),
    dashboard: subtractProductListSummaries(
      getProductListSummarySourceContribution(input.after ?? null, "dashboard", now),
      getProductListSummarySourceContribution(input.before ?? null, "dashboard", now),
    ),
    sellfox: subtractProductListSummaries(
      getProductListSummarySourceContribution(input.after ?? null, "sellfox", now),
      getProductListSummarySourceContribution(input.before ?? null, "sellfox", now),
    ),
  };
}

async function upsertSingleSummary(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    workspaceId: string;
    source: ProductListSource;
    delta: ProductListSummary;
  },
) {
  await tx.productListSummaryRecord.upsert({
    where: {
      organizationId_workspaceId_source: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        source: input.source,
      },
    },
    create: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      source: input.source,
      ...input.delta,
    },
    update: {
      total: { increment: input.delta.total },
      developing: { increment: input.delta.developing },
      opsReview: { increment: input.delta.opsReview },
      designInProgress: { increment: input.delta.designInProgress },
      operationsProgress: { increment: input.delta.operationsProgress },
      overdue: { increment: input.delta.overdue },
    },
  });
}

async function setSingleSummary(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    workspaceId: string;
    source: ProductListSource;
    value: ProductListSummary;
  },
) {
  await tx.productListSummaryRecord.upsert({
    where: {
      organizationId_workspaceId_source: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        source: input.source,
      },
    },
    create: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      source: input.source,
      ...input.value,
    },
    update: input.value,
  });
}

export async function upsertProductListSummaryBundle(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    workspaceId: string;
  },
  bundle: ProductListSummaryBundle,
) {
  for (const source of summarySources) {
    await setSingleSummary(tx, {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      source,
      value: bundle[source],
    });
  }
}

export async function refreshProductListSummaryBundle(input: {
  organizationId: string;
  workspaceId: string;
}) {
  const rebuilt = await rebuildProductListSummaryBundleFromProducts(input);
  await upsertProductListSummaryBundle(prisma, input, rebuilt);
  return rebuilt;
}

export async function applyProductListSummaryChange(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    workspaceId: string;
    before?: ProductListSummarySource | null;
    after?: ProductListSummarySource | null;
  },
) {
  const delta = summaryBundleDelta(input);
  for (const source of summarySources) {
    await upsertSingleSummary(tx, {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      source,
      delta: delta[source],
    });
  }
}
