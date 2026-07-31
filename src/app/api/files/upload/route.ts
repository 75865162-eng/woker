import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { enqueueImportJob } from "@/lib/queue";
import { getStorageDriver } from "@/lib/storage";

export const runtime = "nodejs";

const supportedExtensions = new Set([".csv", ".xls", ".xlsm", ".xlsx"]);

function isSupportedFile(fileName: string) {
  return supportedExtensions.has(path.extname(fileName).toLowerCase());
}

function createStorageKey(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  return `original/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const jobType = String(formData.get("type") ?? "bulk_upload");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing upload file." }, { status: 400 });
    }

    if (!isSupportedFile(file.name)) {
      return NextResponse.json({ error: "Only .xlsx, .xls, .xlsm, and .csv files are supported." }, { status: 400 });
    }

    const storage = getStorageDriver();
    const storageKey = createStorageKey(file.name);
    const storedObject = await storage.putFile({ key: storageKey, file });

    const fileObject = await prisma.fileObject.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        originalName: file.name,
        mimeType: file.type || undefined,
        size: storedObject.size,
        storageKey: storedObject.key,
        storageType: "local",
      },
    });

    const job = await prisma.importJob.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
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
