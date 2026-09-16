import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordDataChangeVersion } from "@/lib/audit/versioning";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { enqueueImportJob } from "@/lib/queue";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const supportedExtensions = new Set([".csv", ".xls", ".xlsm", ".xlsx"]);
const maxUploadSize = 50 * 1024 * 1024;

function isSupportedFile(fileName: string) {
  return supportedExtensions.has(path.extname(fileName).toLowerCase());
}

function createStorageKey(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  return `original/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
}

async function recordVersionSafely(input: Parameters<typeof recordDataChangeVersion>[0]) {
  try {
    await recordDataChangeVersion(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record upload version.";
    console.warn(message);
  }
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("workspace", "create", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const formData = await request.formData();
    const file = formData.get("file");
    const jobType = String(formData.get("type") ?? "bulk_upload");
    const scope = workspaceScopeFromRequest(request, {
      workspaceId: formData.get("workspaceId"),
      accountId: formData.get("accountId"),
      marketplace: formData.get("marketplace"),
    });

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing upload file." }, { status: 400 });
    }

    if (!isSupportedFile(file.name)) {
      return NextResponse.json({ error: "Only .xlsx, .xls, .xlsm, and .csv files are supported." }, { status: 400 });
    }

    if (file.size > maxUploadSize) {
      return NextResponse.json({ error: "文件不能超过 50MB。" }, { status: 400 });
    }

    const storage = getStorageDriver();
    const storageKey = createStorageKey(file.name);
    const storedObject = await storage.putFile({ key: storageKey, file });

    const fileObject = await prisma.fileObject.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        originalName: file.name,
        mimeType: file.type || undefined,
        size: storedObject.size,
        storageKey: storedObject.key,
        storageType: getStorageType(),
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
        type: jobType,
      },
    });
    await recordVersionSafely({
      user,
      entityType: "file_object",
      entityId: fileObject.id,
      action: "file_object_upload",
      summary: file.name,
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
      summary: `${jobType} 已排队`,
      payload: {
        id: job.id,
        fileId: fileObject.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        workspaceId: job.workspaceId,
        accountId: job.accountId,
        marketplace: job.marketplace,
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

    return NextResponse.json({
      job: queuedJob,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
