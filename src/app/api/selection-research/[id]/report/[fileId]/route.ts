import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { prismaResearchRepository } from "@/lib/selection-research/prisma-repository";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string; fileId: string }> }) {
  const permission = await requireApiPermission("agents", "export", request);
  if (!permission.ok) return permission.response;
  try {
    const { id, fileId } = await context.params;
    const scope = workspaceScopeFromRequest(request);
    if (!await assertWorkspaceAccess(permission.user.organizationId, scope.workspaceId)) return NextResponse.json({ error: "Forbidden workspace." }, { status: 403 });
    const { run } = await prismaResearchRepository().read(id, { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, ownerId: permission.user.id });
    if (run.status !== "COMPLETED" || run.report?.fileId !== fileId) return NextResponse.json({ error: "RESEARCH_REPORT_NOT_FOUND" }, { status: 404 });
    const file = await prisma.fileObject.findFirst({ where: {
      id: fileId,
      organizationId: permission.user.organizationId,
      workspaceId: scope.workspaceId,
      userId: permission.user.id,
      originalName: `selection-research-${id}.html`,
      storageKey: { startsWith: `selection-research/${permission.user.organizationId}/${scope.workspaceId}/${id}/` },
      mimeType: "text/html",
    } });
    if (!file) return NextResponse.json({ error: "RESEARCH_REPORT_NOT_FOUND" }, { status: 404 });
    const buffer = await getStorageDriver().getBuffer(file.storageKey);
    if (file.contentHash && createHash("sha256").update(buffer).digest("hex") !== file.contentHash || typeof file.size === "number" && file.size !== buffer.length) return NextResponse.json({ error: "RESEARCH_REPORT_INTEGRITY_FAILED" }, { status: 409 });
    return new Response(new Uint8Array(buffer), { headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
    } });
  } catch (error) {
    if (error instanceof Error && error.message === "RESEARCH_NOT_FOUND") return NextResponse.json({ error: "RESEARCH_REPORT_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ error: "RESEARCH_REPORT_UNAVAILABLE" }, { status: 500 });
  }
}
