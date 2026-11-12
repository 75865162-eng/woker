import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { gallerySaveRepository } from "@/lib/listing-ai/gallery-save-repository";
import { createGallerySaveService } from "@/lib/listing-ai/gallery-save-service";
import { GallerySnapshotError } from "@/lib/listing-ai/gallery-snapshot";

export const runtime = "nodejs";
const service = createGallerySaveService(gallerySaveRepository);
function failure(error: unknown) {
  if (error instanceof GallerySnapshotError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error("Listing AI gallery save failed", error);
  return NextResponse.json({ error: "图片工作区存档暂不可用，请稍后重试。" }, { status: 500 });
}
export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("listingAi", "view", request);
    if (!permission.ok) return permission.response;
    const scope = { organizationId: permission.user.organizationId, userId: permission.user.id, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (id) {
      if (id.length > 100) return NextResponse.json({ error: "记录不存在。" }, { status: 404 });
      const result = await service.restore(scope, id);
      return result ? NextResponse.json(result) : NextResponse.json({ error: "记录不存在或无权访问。" }, { status: 404 });
    }
    const page = Number(params.get("page") ?? 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 10_000) return NextResponse.json({ error: "页码无效。" }, { status: 400 });
    return NextResponse.json(await service.list(scope, page));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("listingAi", "edit", request);
    if (!permission.ok) return permission.response;
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 4 * 1024 * 1024) return NextResponse.json({ error: "文字和格式数据超过 4MB，请减少后再保存。" }, { status: 413 });
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed as Record<string, unknown>;
    } catch { return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 }); }
    const { user } = permission;
    const scope = { organizationId: user.organizationId, userId: user.id, workspaceId: workspaceScopeFromRequest(request, body).workspaceId };
    const record = await service.save(scope, user.name || user.email, body.name, body.snapshot);
    return NextResponse.json({ record }, { status: 201 });
  } catch (error) { return failure(error); }
}
