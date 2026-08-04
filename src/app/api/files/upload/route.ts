import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
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

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("workspace", "create");

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

    await enqueueImportJob(job.id);

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
