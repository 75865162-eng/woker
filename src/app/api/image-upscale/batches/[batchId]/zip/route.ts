import JSZip from "jszip";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const permission = await requireApiPermission("imageUpscale", "view", request);
  if (!permission.ok) return permission.response;
  const { batchId } = await params;
  const jobs = await prisma.imageUpscaleJob.findMany({ where: { batchId, organizationId: permission.user.organizationId, status: "completed", outputKey: { not: null } }, orderBy: { createdAt: "asc" } });
  if (jobs.length === 0) return NextResponse.json({ error: "该批次没有可下载的结果。" }, { status: 404 });
  const zip = new JSZip();
  const storage = getStorageDriver();
  for (const job of jobs) {
    if (job.outputKey) zip.file(`${job.originalName.replace(/\.[^.]+$/, "")}-${job.scale}x-upscaled.png`, await storage.getBuffer(job.outputKey));
  }
  const body = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return new Response(Buffer.from(body), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="image-upscale-${batchId}.zip"`, "Cache-Control": "private, max-age=3600" } });
}
