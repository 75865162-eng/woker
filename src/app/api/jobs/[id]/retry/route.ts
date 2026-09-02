import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordDataChangeVersion } from "@/lib/audit/versioning";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { enqueueImportJob } from "@/lib/queue";

export const runtime = "nodejs";

async function recordVersionSafely(input: Parameters<typeof recordDataChangeVersion>[0]) {
  try {
    await recordDataChangeVersion(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record retry version.";
    console.warn(message);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const permission = await requireApiPermission("workspace", "edit", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;
    const { id } = await params;

    const existingJob = await prisma.importJob.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
      },
    });

    if (!existingJob) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    if (existingJob.status !== "failed") {
      return NextResponse.json({ error: "Only failed jobs can be retried." }, { status: 409 });
    }

    const job = await prisma.importJob.update({
      where: { id },
      data: {
        status: "queued",
        progress: 0,
        error: null,
      },
      include: { file: true },
    });
    await recordVersionSafely({
      user,
      entityType: "import_job",
      entityId: job.id,
      action: "import_job_retry",
      summary: `${job.file.originalName} 重新排队`,
      payload: {
        id: job.id,
        fileId: job.fileId,
        type: job.type,
        status: job.status,
        progress: job.progress,
        workspaceId: job.workspaceId,
        accountId: job.accountId,
        marketplace: job.marketplace,
      } as unknown as Prisma.InputJsonValue,
      scope: {
        workspaceId: job.workspaceId,
        accountId: job.accountId,
        marketplace: job.marketplace,
      },
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

    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to retry job.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
