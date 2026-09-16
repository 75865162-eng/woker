import type { Prisma } from "@prisma/client";
import { productProjectionNames, productProjectionVersion, type ProductProjectionName } from "@/lib/products/product-projection";

type ProjectionStateClient = Prisma.TransactionClient;

export async function markProductProjectionsProcessing(
  tx: ProjectionStateClient,
  input: {
    productRecordId: string;
    organizationId: string;
    workspaceId: string;
    sourceRevision: number;
    attempt: number;
  },
) {
  const now = new Date();
  for (const projectionName of productProjectionNames) {
    const updated = await tx.productProjectionState.updateMany({
      where: {
        productRecordId: input.productRecordId,
        projectionName,
        OR: [
          { sourceRevision: null },
          { sourceRevision: { lte: input.sourceRevision } },
        ],
      },
      data: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        status: "processing",
        sourceRevision: input.sourceRevision,
        projectionVersion: productProjectionVersion,
        attempts: input.attempt,
        lastStartedAt: now,
        lastError: null,
        nextRetryAt: null,
      },
    });
    if (updated.count) continue;

    try {
      await tx.productProjectionState.create({
        data: {
          productRecordId: input.productRecordId,
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          projectionName,
          status: "processing",
          sourceRevision: input.sourceRevision,
          projectionVersion: productProjectionVersion,
          attempts: input.attempt,
          lastStartedAt: now,
          lastError: null,
          nextRetryAt: null,
        },
      });
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "P2002") {
        throw error;
      }
    }
  }
}

export async function markProductProjectionsReady(
  tx: ProjectionStateClient,
  input: {
    productRecordId: string;
    organizationId: string;
    workspaceId: string;
    sourceRevision: number;
    projectionNames?: ProductProjectionName[];
  },
) {
  const now = new Date();
  await tx.productProjectionState.updateMany({
    where: {
      productRecordId: input.productRecordId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      OR: [
        { sourceRevision: null },
        { sourceRevision: { lte: input.sourceRevision } },
      ],
      ...(input.projectionNames ? { projectionName: { in: input.projectionNames } } : {}),
    },
    data: {
      status: "ready",
      sourceRevision: input.sourceRevision,
      projectionVersion: productProjectionVersion,
      lastCompletedAt: now,
      lastError: null,
      nextRetryAt: null,
    },
  });
}

export async function markProductProjectionsFailed(
  tx: ProjectionStateClient,
  input: {
    productRecordId: string;
    organizationId: string;
    workspaceId: string;
    sourceRevision?: number;
    attempt: number;
    error: string;
    nextRetryAt: Date;
    projectionNames?: ProductProjectionName[];
  },
) {
  const projectionNames: ProductProjectionName[] = input.projectionNames ?? [...productProjectionNames];
  for (const projectionName of projectionNames) {
    const revisionGuard = input.sourceRevision == null
      ? {}
      : {
          OR: [
            { sourceRevision: null },
            { sourceRevision: { lte: input.sourceRevision } },
          ],
        };
    const updated = await tx.productProjectionState.updateMany({
      where: {
        productRecordId: input.productRecordId,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        projectionName,
        ...revisionGuard,
      },
      data: {
        status: "failed",
        sourceRevision: input.sourceRevision ?? undefined,
        projectionVersion: productProjectionVersion,
        attempts: input.attempt,
        lastError: input.error,
        nextRetryAt: input.nextRetryAt,
      },
    });
    if (!updated.count) {
      try {
        await tx.productProjectionState.create({
          data: {
            productRecordId: input.productRecordId,
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            projectionName,
            status: "failed",
            sourceRevision: input.sourceRevision ?? null,
            projectionVersion: productProjectionVersion,
            attempts: input.attempt,
            lastError: input.error,
            nextRetryAt: input.nextRetryAt,
          },
        });
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "P2002") {
          throw error;
        }
      }
    }
    await tx.productProjectionFailure.create({
      data: {
        productRecordId: input.productRecordId,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        projectionName,
        sourceRevision: input.sourceRevision ?? null,
        projectionVersion: productProjectionVersion,
        attempt: input.attempt,
        error: input.error,
      },
    });
  }
}
