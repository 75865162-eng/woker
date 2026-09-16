import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const permission = await requireApiPermission("imageUpscale", "view", request);
  if (!permission.ok) return permission.response;
  const { id } = await params;
  const job = await prisma.imageUpscaleJob.findFirst({ where: { id, organizationId: permission.user.organizationId } });
  if (!job || job.status !== "completed" || !job.outputKey) return NextResponse.json({ error: "放大结果尚未准备好。" }, { status: 404 });
  const body = new Uint8Array(await getStorageDriver().getBuffer(job.outputKey));
  const fileName = encodeURIComponent(`${job.originalName.replace(/\.[^.]+$/, "")}-${job.scale}x-upscaled.png`);
  return new Response(body, { headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`, "Cache-Control": "private, max-age=3600" } });
}
