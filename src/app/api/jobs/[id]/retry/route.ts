import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { enqueueImportJob } from "@/lib/queue";

export const runtime = "nodejs";

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

    await enqueueImportJob(job.id);

    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to retry job.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
