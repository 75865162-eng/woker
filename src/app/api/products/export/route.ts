import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordDataChangeVersion } from "@/lib/audit/versioning";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { enqueueImportJob } from "@/lib/queue";
import { buildProductExportPayload, createProductExportFileName, createProductExportStorageKey } from "@/lib/products/product-export-job";
import { getStorageType } from "@/lib/storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

function createDownloadUrl(jobId: string) {
  return `/api/files/${encodeURIComponent(jobId)}/download`;
}

async function recordVersionSafely(input: Parameters<typeof recordDataChangeVersion>[0]) {
  try {
    await recordDataChangeVersion(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record export version.";
    console.warn(message);
  }
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("products", "export", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const url = new URL(request.url);
    const scope = workspaceScopeFromRequest(request);
    const payload = buildProductExportPayload(url);
    const fileName = createProductExportFileName();
    const storageKey = createProductExportStorageKey();

    const fileObject = await prisma.fileObject.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        originalName: fileName,
        mimeType: "text/csv; charset=utf-8",
        size: 0,
        storageKey,
        storageType: getStorageType(),
        status: "processing",
      },
    });

    const job = await prisma.importJob.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        fileId: fileObject.id,
        type: "product_export",
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });

    await recordVersionSafely({
      user,
      entityType: "file_object",
      entityId: fileObject.id,
      action: "file_object_export_queue",
      summary: fileObject.originalName,
      payload: {
        id: fileObject.id,
        originalName: fileObject.originalName,
        mimeType: fileObject.mimeType,
        size: fileObject.size,
        storageKey: fileObject.storageKey,
        storageType: fileObject.storageType,
        workspaceId: fileObject.workspaceId,
        accountId: fileObject.accountId,
        marketplace: fileObject.marketplace,
      } as unknown as Prisma.InputJsonValue,
      scope,
    });
    await recordVersionSafely({
      user,
      entityType: "import_job",
      entityId: job.id,
      action: "import_job_queue",
      summary: `${fileObject.originalName} 已排队`,
      payload: {
        id: job.id,
        fileId: fileObject.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        workspaceId: job.workspaceId,
        accountId: job.accountId,
        marketplace: job.marketplace,
        payload,
      } as unknown as Prisma.InputJsonValue,
      scope,
    });

    try {
      await enqueueImportJob(job.id);
    } catch (enqueueError) {
      const message = enqueueError instanceof Error ? enqueueError.message : "Failed to enqueue job.";
      await prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          progress: 0,
          error: message,
          file: {
            update: {
              status: "failed",
            },
          },
        },
      });
      throw enqueueError;
    }

    const queuedJob = await prisma.importJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { file: true },
    });

    const file = queuedJob.status === "done"
      ? {
          id: queuedJob.fileId,
          name: queuedJob.file.originalName,
          downloadUrl: createDownloadUrl(queuedJob.id),
        }
      : null;

    return NextResponse.json({
      job: queuedJob,
      file,
      queued: queuedJob.status !== "done",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to export products.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
