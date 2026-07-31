import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { id } = await params;
    const job = await prisma.importJob.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        file: {
          organizationId: user.organizationId,
        },
      },
      include: { file: true },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    if (job.status !== "done" || !job.resultKey) {
      return NextResponse.json({ error: "Job result is not ready." }, { status: 409 });
    }

    const buffer = await getStorageDriver().getBuffer(job.resultKey);
    const body = new Uint8Array(buffer);
    const baseName = job.file.originalName.replace(/\.[^.]+$/, "");
    const fileName = encodeURIComponent(`${baseName}-optimized.xlsx`);

    return new Response(body, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
