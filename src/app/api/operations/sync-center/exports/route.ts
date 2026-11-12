import { NextResponse } from "next/server";
import { requireAmazonReadSession } from "@/lib/auth/amazon-read-session";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";
import { assertExportAccess, assertExportJobAccess, requestSalesExport } from "@/lib/amazon-sync/exports";
import { AmazonReadError } from "@/lib/amazon-sync/read-account";
import { requireSyncCenter, SyncInputError } from "@/lib/amazon-sync/policy";
export const runtime = "nodejs";
const json = (v: unknown, status = 200) => NextResponse.json(v, { status, headers: { "Cache-Control": "no-store" } });
async function handle(request: Request, create: boolean) {
  const permission = await requireAmazonReadSession(request);
  if (!permission.ok) return permission.response;
  try {
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    requireSyncCenter(scope);
    await prisma.$transaction(tx => assertExportAccess(tx, scope, permission.user.id));
    if (create) {
      const body: unknown = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new SyncInputError("请求须为对象。");
      return json(await requestSalesExport(scope, permission.user.id, body as Record<string, unknown>), 202);
    }
    const params = new URL(request.url).searchParams;
    const job = await prisma.amazonDataExport.findFirst({ where: { ...scope, id: params.get("id") ?? "", requestedByUserId: permission.user.id }, include: { file: true } });
    if (!job) return json({ error: "导出任务不存在。" }, 404);
    await prisma.$transaction(tx => assertExportJobAccess(tx, scope, permission.user.id, job.query));
    if (params.get("download") !== "1") return json({ id: job.id, status: job.status, rowCount: job.rowCount, query: job.query, asOf: job.cutoff, error: job.error, finishedAt: job.finishedAt });
    if (job.status !== "SUCCEEDED" || !job.file) return json({ error: "导出文件尚未就绪。" }, 409);
    if (job.file.organizationId !== scope.organizationId || job.file.workspaceId !== scope.workspaceId || job.file.userId !== permission.user.id) return json({ error: "Forbidden." }, 403);
    const buffer = await getStorageDriver().getBuffer(job.file.storageKey);
    // Revalidate after storage read, before returning the bytes.
    await prisma.$transaction(tx => assertExportJobAccess(tx, scope, permission.user.id, job.query));
    await prisma.auditLog.create({ data: { organizationId: scope.organizationId, userId: permission.user.id, action: "amazon.data.export.downloaded", entityType: "AmazonDataExport", entityId: job.id, metadata: { workspaceId: scope.workspaceId, fileId: job.file.id } } });
    return new Response(new Uint8Array(buffer), { headers: { "Cache-Control": "no-store", "Content-Type": "application/x-ndjson", "Content-Disposition": `attachment; filename="amazon-sales-${job.id}.jsonl"` } });
  } catch (e) { return json({ error: e instanceof SyncInputError ? e.message : "导出请求失败。", ...(e instanceof AmazonReadError ? { code: e.businessCode } : {}) }, e instanceof SyncInputError ? e.status : 500); }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
