import { createHash, randomUUID } from "node:crypto";
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

function hashBuffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function getUploadErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Upload failed.";

  if (message.includes("contentHash")) {
    return "数据库未应用文件去重迁移，请先执行 Prisma migration 后再上传 Bulk 文件。";
  }

  return message;
}

async function findExistingFileObject(input: {
  organizationId: string;
  workspaceId: string;
  accountId: string;
  marketplace: string;
  storageType: ReturnType<typeof getStorageType>;
  contentHash: string;
  size: number;
}) {
  const matchedFileObject = await prisma.fileObject.findFirst({
    where: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      accountId: input.accountId,
      marketplace: input.marketplace,
      storageType: input.storageType,
      contentHash: input.contentHash,
      size: input.size,
    },
    include: {
      workspaceDatasets: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (matchedFileObject) {
    return matchedFileObject;
  }

  const storage = getStorageDriver();
  const legacyCandidates = await prisma.fileObject.findMany({
    where: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      accountId: input.accountId,
      marketplace: input.marketplace,
      storageType: input.storageType,
      contentHash: null,
      size: input.size,
    },
    include: {
      workspaceDatasets: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  for (const candidate of legacyCandidates) {
    try {
      const candidateHash = hashBuffer(await storage.getBuffer(candidate.storageKey));

      await prisma.fileObject.update({
        where: { id: candidate.id },
        data: { contentHash: candidateHash },
      });

      if (candidateHash === input.contentHash) {
        return { ...candidate, contentHash: candidateHash };
      }
    } catch {
      // Ignore unreadable legacy objects and continue with a fresh upload.
    }
  }

  return null;
}

export async function POST(request: Request) {
  let uploadedStorageKey: string | undefined;

  try {
    const permission = await requireApiPermission(request, "workspace", "create");

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

    const storageType = getStorageType();
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const contentHash = hashBuffer(fileBuffer);
    const existingFileObject = await findExistingFileObject({
      organizationId: user.organizationId,
      workspaceId: scope.workspaceId,
      accountId: scope.accountId,
      marketplace: scope.marketplace,
      storageType,
      contentHash,
      size: fileBuffer.byteLength,
    });

    if (existingFileObject) {
      const existingDataset = existingFileObject.workspaceDatasets[0];

      if (existingDataset) {
        const existingJob = await prisma.importJob.findUnique({
          where: { id: existingDataset.jobId },
          include: { file: true, workspaceDataset: true },
        });

        if (existingJob) {
          return NextResponse.json({ job: existingJob });
        }
      }

      const job = await prisma.importJob.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          workspaceId: scope.workspaceId,
          accountId: scope.accountId,
          marketplace: scope.marketplace,
          fileId: existingFileObject.id,
          type: jobType,
        },
        include: { file: true, workspaceDataset: true },
      });

      await enqueueImportJob(job.id);

      const queuedJob = await prisma.importJob.findUniqueOrThrow({
        where: { id: job.id },
        include: { file: true, workspaceDataset: true },
      });

      return NextResponse.json({
        job: queuedJob,
      });
    }

    const storage = getStorageDriver();
    const storageKey = createStorageKey(file.name);
    const storedObject = await storage.putBuffer({
      key: storageKey,
      buffer: fileBuffer,
      contentType: file.type || undefined,
    });
    uploadedStorageKey = storedObject.key;

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
        contentHash,
        storageKey: storedObject.key,
        storageType,
      },
    });
    uploadedStorageKey = undefined;

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
      include: { file: true, workspaceDataset: true },
    });

    return NextResponse.json({
      job: queuedJob,
    });
  } catch (error) {
    if (uploadedStorageKey) {
      await getStorageDriver().delete(uploadedStorageKey).catch(() => undefined);
    }

    return NextResponse.json({ error: getUploadErrorMessage(error) }, { status: 500 });
  }
}
