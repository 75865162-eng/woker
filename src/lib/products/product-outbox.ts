import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { Product } from "@/lib/products/types";
import { invalidateProductListCaches } from "@/lib/products/product-list-cache";
import { applyProductListSummaryChange } from "@/lib/products/product-list-summary";
import { createWorkflowNotifications } from "@/lib/products/workflow-notifications";
import {
  lockProductRecordForProjection,
  productRecordPayloadToProduct,
  projectProductRecord,
} from "@/lib/products/product-projection";
import { normalizeWorkflowStage } from "@/lib/products/list-query";
import {
  markProductProjectionsFailed,
  markProductProjectionsProcessing,
  markProductProjectionsReady,
} from "@/lib/products/product-projection-state";

type ProductOutboxPayload = {
  productRecordId: string;
  revision: number;
  previousWorkflowStage?: string | null;
  actorName: string;
};

export type ProductOutboxHealth = {
  outbox: {
    queued: number;
    running: number;
    failed: number;
    staleRunning: number;
    oldestQueuedAt: Date | null;
    oldestRunningAt: Date | null;
    oldestFailedAt: Date | null;
  };
  projections: {
    pending: number;
    processing: number;
    failed: number;
    staleFailures: number;
    oldestFailedAt: Date | null;
  };
  consistency: {
    productRecords: number;
    missingSummary: number;
    staleSummary: number;
    missingText: number;
    staleText: number;
    missingProjectionStates: number;
  };
  staleAfterMs: number;
};

export function resolveProjectionFailureRevision(input: {
  currentRevision?: number | null;
  eventRevision?: number | null;
}) {
  return input.currentRevision ?? input.eventRevision ?? undefined;
}

type ProductOutboxHealthRow = {
  queued: number | bigint;
  running: number | bigint;
  failed: number | bigint;
  staleRunning: number | bigint;
  oldestQueuedAt: Date | null;
  oldestRunningAt: Date | null;
  oldestFailedAt: Date | null;
};

type ProductProjectionHealthRow = {
  pending: number | bigint;
  processing: number | bigint;
  failed: number | bigint;
  staleFailures: number | bigint;
  oldestFailedAt: Date | null;
};

type ProductConsistencyHealthRow = {
  productRecords: number | bigint;
  missingSummary: number | bigint;
  staleSummary: number | bigint;
  missingText: number | bigint;
  staleText: number | bigint;
  missingProjectionStates: number | bigint;
};

function toHealthCount(value: number | bigint | null | undefined) {
  return Number(value ?? 0);
}

export async function getProductOutboxHealth(input: {
  organizationId: string;
  workspaceId: string;
  staleAfterMs?: number;
}) {
  const staleAfterMs = input.staleAfterMs ?? 10 * 60_000;
  const staleCutoff = new Date(Date.now() - staleAfterMs);

  const [outboxRows, projectionRows, consistencyRows] = await Promise.all([
    prisma.$queryRaw<ProductOutboxHealthRow[]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE "status" = 'queued')::int AS "queued",
        COUNT(*) FILTER (WHERE "status" = 'running')::int AS "running",
        COUNT(*) FILTER (WHERE "status" = 'failed')::int AS "failed",
        COUNT(*) FILTER (WHERE "status" = 'running' AND "updatedAt" < ${staleCutoff})::int AS "staleRunning",
        MIN("createdAt") FILTER (WHERE "status" = 'queued') AS "oldestQueuedAt",
        MIN("createdAt") FILTER (WHERE "status" = 'running') AS "oldestRunningAt",
        MIN("createdAt") FILTER (WHERE "status" = 'failed') AS "oldestFailedAt"
      FROM "ProductOutboxEvent"
      WHERE "organizationId" = ${input.organizationId}
        AND "workspaceId" = ${input.workspaceId}
    `),
    prisma.$queryRaw<ProductProjectionHealthRow[]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE p."status" = 'pending')::int AS "pending",
        COUNT(*) FILTER (WHERE p."status" = 'processing')::int AS "processing",
        COUNT(*) FILTER (WHERE p."status" = 'failed')::int AS "failed",
        COUNT(*) FILTER (
          WHERE p."status" = 'failed'
            AND p."updatedAt" < ${staleCutoff}
        )::int AS "staleFailures",
        MIN(p."updatedAt") FILTER (WHERE p."status" = 'failed') AS "oldestFailedAt"
      FROM "ProductProjectionState" p
      INNER JOIN "ProductRecord" r
        ON r."id" = p."productRecordId"
        AND r."organizationId" = p."organizationId"
        AND r."workspaceId" = p."workspaceId"
        AND (p."sourceRevision" = r."revision" OR p."sourceRevision" IS NULL)
      WHERE p."organizationId" = ${input.organizationId}
        AND p."workspaceId" = ${input.workspaceId}
    `),
    prisma.$queryRaw<ProductConsistencyHealthRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::int AS "productRecords",
        COUNT(*) FILTER (WHERE s."productRecordId" IS NULL)::int AS "missingSummary",
        COUNT(*) FILTER (
          WHERE s."productRecordId" IS NOT NULL
            AND s."sourceRevision" <> r."revision"
        )::int AS "staleSummary",
        COUNT(*) FILTER (WHERE t."productRecordId" IS NULL)::int AS "missingText",
        COUNT(*) FILTER (
          WHERE t."productRecordId" IS NOT NULL
            AND t."sourceRevision" <> r."revision"
        )::int AS "staleText",
        COUNT(*) FILTER (
          WHERE COALESCE(ps."stateCount", 0) < 4
        )::int AS "missingProjectionStates"
      FROM "ProductRecord" r
      LEFT JOIN "ProductSummaryRecord" s
        ON s."productRecordId" = r."id"
        AND s."organizationId" = r."organizationId"
        AND s."workspaceId" = r."workspaceId"
      LEFT JOIN "ProductTextRecord" t
        ON t."productRecordId" = r."id"
        AND t."organizationId" = r."organizationId"
        AND t."workspaceId" = r."workspaceId"
        AND t."language" = 'default'
      LEFT JOIN (
        SELECT
          p."productRecordId",
          p."organizationId",
          p."workspaceId",
          COUNT(*)::int AS "stateCount"
        FROM "ProductProjectionState" p
        INNER JOIN "ProductRecord" current_record
          ON current_record."id" = p."productRecordId"
          AND current_record."organizationId" = p."organizationId"
          AND current_record."workspaceId" = p."workspaceId"
          AND (p."sourceRevision" = current_record."revision" OR p."sourceRevision" IS NULL)
        GROUP BY p."productRecordId", p."organizationId", p."workspaceId"
      ) ps
        ON ps."productRecordId" = r."id"
        AND ps."organizationId" = r."organizationId"
        AND ps."workspaceId" = r."workspaceId"
      WHERE r."organizationId" = ${input.organizationId}
        AND r."workspaceId" = ${input.workspaceId}
    `),
  ]);

  const outbox = outboxRows[0];
  const projections = projectionRows[0];
  const consistency = consistencyRows[0];

  return {
    outbox: {
      queued: toHealthCount(outbox?.queued),
      running: toHealthCount(outbox?.running),
      failed: toHealthCount(outbox?.failed),
      staleRunning: toHealthCount(outbox?.staleRunning),
      oldestQueuedAt: outbox?.oldestQueuedAt ?? null,
      oldestRunningAt: outbox?.oldestRunningAt ?? null,
      oldestFailedAt: outbox?.oldestFailedAt ?? null,
    },
    projections: {
      pending: toHealthCount(projections?.pending),
      processing: toHealthCount(projections?.processing),
      failed: toHealthCount(projections?.failed),
      staleFailures: toHealthCount(projections?.staleFailures),
      oldestFailedAt: projections?.oldestFailedAt ?? null,
    },
    consistency: {
      productRecords: toHealthCount(consistency?.productRecords),
      missingSummary: toHealthCount(consistency?.missingSummary),
      staleSummary: toHealthCount(consistency?.staleSummary),
        missingText: toHealthCount(consistency?.missingText),
        staleText: toHealthCount(consistency?.staleText),
        missingProjectionStates: toHealthCount(consistency?.missingProjectionStates),
    },
    staleAfterMs,
  } satisfies ProductOutboxHealth;
}

async function getAuditUser(event: { userId: string | null; organizationId: string }) {
  if (!event.userId) return undefined;

  const user = await prisma.user.findUnique({
    where: { id: event.userId },
    include: {
      memberships: {
        where: { organizationId: event.organizationId },
        include: { organization: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });
  const membership = user?.memberships[0];
  if (!user || user.status !== "active" || !membership) return undefined;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: membership.role,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
  };
}

export async function processProductOutboxEvent(eventId: string) {
  const claimed = await prisma.productOutboxEvent.updateMany({
    where: {
      id: eventId,
      status: { in: ["queued", "failed"] },
      availableAt: { lte: new Date() },
      attempts: { lt: 5 },
    },
    data: {
      status: "running",
      attempts: { increment: 1 },
      lastError: null,
    },
  });

  if (!claimed.count) return;

  const event = await prisma.productOutboxEvent.findUnique({ where: { id: eventId } });
  if (!event) return;

  let projectionPhase: "read_models" | "committed" = "read_models";
  let projectionSourceRevision: number | undefined;
  try {
    if (event.eventType === "product_projection_requested") {
      const projectionPayload = event.payload as { productRecordId?: string };
      const record = projectionPayload.productRecordId
        ? await prisma.productRecord.findFirst({
            where: {
              id: projectionPayload.productRecordId,
              organizationId: event.organizationId,
              workspaceId: event.workspaceId,
            },
            select: {
              id: true,
              organizationId: true,
              workspaceId: true,
              accountId: true,
              marketplace: true,
              revision: true,
              createdAt: true,
              updatedAt: true,
              payload: true,
            },
          })
        : null;

      if (!record) {
        throw new Error("Product record not found for projection event.");
      }

      let projectedRevision = record.revision;
      await prisma.$transaction(async (tx) => {
        const currentRecord = await lockProductRecordForProjection(tx, {
          id: record.id,
          organizationId: record.organizationId,
          workspaceId: record.workspaceId,
        });
        projectedRevision = currentRecord.revision;
        projectionSourceRevision = currentRecord.revision;
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(
              ${`${currentRecord.organizationId}:${currentRecord.workspaceId}:product-list-summary`},
              0
            )
          )
        `;
        const previousSummary = await tx.productSummaryRecord.findUnique({
          where: { productRecordId: currentRecord.id },
        });
        const toSummaryDeltaInput = (summary: {
          productRecordId: string;
          source: string;
          status: string;
          workflowDueAt: Date | null;
          operationsProgressIncomplete: boolean;
          createdAt?: Date;
        } | null) => summary
          ? {
              id: summary.productRecordId,
              source: summary.source,
              status: summary.status as Product["status"],
              workflowDueAt: summary.workflowDueAt?.toISOString(),
              operationsProgressIncomplete: summary.operationsProgressIncomplete,
              ...(summary.createdAt ? { createdAt: summary.createdAt.toISOString() } : {}),
            }
          : null;
        await markProductProjectionsProcessing(tx, {
          productRecordId: currentRecord.id,
          organizationId: currentRecord.organizationId,
          workspaceId: currentRecord.workspaceId,
          sourceRevision: currentRecord.revision,
          attempt: event.attempts,
        });
        const projection = await projectProductRecord(tx, currentRecord);
        await applyProductListSummaryChange(tx, {
          organizationId: currentRecord.organizationId,
          workspaceId: currentRecord.workspaceId,
          before: toSummaryDeltaInput(previousSummary),
          after: toSummaryDeltaInput(projection.summary),
        });
        await markProductProjectionsReady(tx, {
          productRecordId: currentRecord.id,
          organizationId: currentRecord.organizationId,
          workspaceId: currentRecord.workspaceId,
          sourceRevision: currentRecord.revision,
          projectionNames: ["summary", "text", "product_center"],
        });
        await markProductProjectionsReady(tx, {
          productRecordId: record.id,
          organizationId: record.organizationId,
          workspaceId: record.workspaceId,
          sourceRevision: projectedRevision,
          projectionNames: ["list_summary"],
        });
      });
      projectionPhase = "committed";
      try {
        await invalidateProductListCaches(`${event.organizationId}:${event.workspaceId}:`);
      } catch (error) {
        console.warn("[product-outbox] product list cache invalidation failed", {
          eventId: event.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      await prisma.productOutboxEvent.update({
        where: { id: event.id },
        data: { status: "done", processedAt: new Date(), lastError: null },
      });
      return;
    }

    const payload = event.payload as unknown as ProductOutboxPayload;
    const record = payload.productRecordId
      ? await prisma.productRecord.findFirst({
          where: {
            id: payload.productRecordId,
            organizationId: event.organizationId,
            workspaceId: event.workspaceId,
          },
          select: {
            payload: true,
            revision: true,
          },
        })
      : null;
    if (!record) {
      throw new Error("Product record not found for outbox event.");
    }
    const product = productRecordPayloadToProduct(record.payload);
    const auditUser = await getAuditUser(event);

    if (auditUser && event.eventType === "product_saved") {
      await createWorkflowNotifications({
        user: {
          id: auditUser.id,
          name: payload.actorName || auditUser.name,
          organizationId: auditUser.organizationId,
        },
        product,
        previousProduct: normalizeWorkflowStage(payload.previousWorkflowStage ?? "")
          ? { workflowStage: normalizeWorkflowStage(payload.previousWorkflowStage ?? "") }
          : undefined,
        idempotencyKey: event.id,
      });
    }

    await invalidateProductListCaches(`${event.organizationId}:${event.workspaceId}:`);
    await prisma.productOutboxEvent.update({
      where: { id: event.id },
      data: { status: "done", processedAt: new Date(), lastError: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Product outbox processing failed.";
    const attempts = event.attempts;
    if (event.eventType === "product_projection_requested") {
      const projectionPayload = event.payload as { productRecordId?: string; revision?: number };
      if (projectionPayload.productRecordId) {
        const nextRetryAt = new Date(Date.now() + Math.min(60_000, 2 ** attempts * 1000));
        const recordExists = await prisma.productRecord.findFirst({
          where: {
            id: projectionPayload.productRecordId,
            organizationId: event.organizationId,
            workspaceId: event.workspaceId,
          },
          select: { id: true },
        });
        if (recordExists && projectionPhase !== "committed") {
          await prisma.$transaction((tx) =>
            markProductProjectionsFailed(tx, {
              productRecordId: projectionPayload.productRecordId as string,
              organizationId: event.organizationId,
              workspaceId: event.workspaceId,
              sourceRevision: resolveProjectionFailureRevision({
                currentRevision: projectionSourceRevision,
                eventRevision: projectionPayload.revision,
              }),
              attempt: attempts,
              error: message,
              nextRetryAt,
              projectionNames: ["summary", "text", "list_summary", "product_center"],
            }),
          );
        }
      }
    }
    await prisma.productOutboxEvent.update({
      where: { id: event.id },
      data: {
        status: attempts >= 5 ? "failed" : "queued",
        availableAt: new Date(Date.now() + Math.min(60_000, 2 ** attempts * 1000)),
        lastError: message,
      },
    });
    throw error;
  }
}

export async function enqueuePendingProductOutboxEvents(limit = 50) {
  return prisma.productOutboxEvent.findMany({
    where: {
      status: { in: ["queued", "failed"] },
      availableAt: { lte: new Date() },
      attempts: { lt: 5 },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
}

export async function recoverStaleProductOutboxEvents(staleAfterMs = 10 * 60_000) {
  const cutoff = new Date(Date.now() - staleAfterMs);
  await prisma.productOutboxEvent.updateMany({
    where: {
      status: "running",
      updatedAt: { lt: cutoff },
      attempts: { lt: 5 },
    },
    data: {
      status: "queued",
      availableAt: new Date(),
      lastError: "Outbox 处理进程异常退出，已自动恢复重试。",
    },
  });
}

export async function markExpiredProductAttachmentsOrphaned() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.productAttachmentBinding.updateMany({
    where: {
      status: "temporary",
      updatedAt: { lt: cutoff },
    },
    data: { status: "orphan" },
  });
  await prisma.fileObject.updateMany({
    where: {
      productBindingStatus: "temporary",
      updatedAt: { lt: cutoff },
    },
    data: { productBindingStatus: "orphan" },
  });
}
