import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { enqueueImageUpscaleJob } from "@/lib/queue";
import { getStorageDriver } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const permission = await requireApiPermission("imageUpscale", "view", request);
  if (!permission.ok) return permission.response;
  const { id } = await params;
  const job = await prisma.imageUpscaleJob.findFirst({ where: { id, organizationId: permission.user.organizationId } });
  if (!job) return NextResponse.json({ error: "图片任务不存在。" }, { status: 404 });
  return NextResponse.json({ job });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const permission = await requireApiPermission("imageUpscale", "edit", request);
  if (!permission.ok) return permission.response;
  const { id } = await params;
  const existing = await prisma.imageUpscaleJob.findFirst({ where: { id, organizationId: permission.user.organizationId } });
  if (!existing) return NextResponse.json({ error: "图片任务不存在。" }, { status: 404 });
  if (existing.status !== "failed") return NextResponse.json({ error: "只有失败任务可以重试。" }, { status: 409 });
  const job = await prisma.imageUpscaleJob.update({
    where: { id },
    data: { status: "queued", progress: 0, error: null, outputKey: null, processingMs: null, completedAt: null },
  });
  try {
    await enqueueImageUpscaleJob(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "图片任务重新入队失败。";
    await prisma.imageUpscaleJob.update({ where: { id }, data: { status: "failed", error: message } });
    return NextResponse.json({ error: message }, { status: 503 });
  }
  return NextResponse.json({ job });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const permission = await requireApiPermission("imageUpscale", "edit", request);
  if (!permission.ok) return permission.response;
  const { id } = await params;
  const job = await prisma.imageUpscaleJob.findFirst({ where: { id, organizationId: permission.user.organizationId } });
  if (!job) return NextResponse.json({ error: "图片任务不存在。" }, { status: 404 });
  const storage = getStorageDriver();
  await storage.delete(job.inputKey).catch(() => undefined);
  if (job.outputKey) await storage.delete(job.outputKey).catch(() => undefined);
  await prisma.imageUpscaleJob.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
