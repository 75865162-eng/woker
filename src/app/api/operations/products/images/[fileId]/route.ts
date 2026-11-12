import { requireAmazonReadSession } from "@/lib/auth/amazon-read-session";
import { AmazonReadError, amazonAccountReadAccess } from "@/lib/amazon-sync/read-account";
import { readAccessibleProductImage } from "@/lib/operations/amazon-product-images";
import { getStorageDriver } from "@/lib/storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const permission = await requireAmazonReadSession(request);
  if (!permission.ok) return permission.response;
  const { fileId } = await params;
  if (!/^[a-z0-9-]{20,64}$/i.test(fileId)) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
  try {
    const query = new URL(request.url).searchParams;
    const access = await amazonAccountReadAccess(scope, permission.user.id, query);
    query.set("sellerAccountId", access.sellerIds[0]);
    const image = await readAccessibleProductImage(scope, fileId, access);
    if (!image || image.status !== "done" || image.mimeType !== "image/webp") return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    const buffer = await getStorageDriver().getBoundedBuffer?.(image.storageKey, 2_000_000);
    if (!buffer) return new Response(null, { status: 503 });
    const live = await amazonAccountReadAccess(scope, permission.user.id, query);
    if (!await readAccessibleProductImage(scope, fileId, live)) return new Response(null, { status: 403 });
    return new Response(new Uint8Array(buffer), { headers: {
      "Cache-Control": "no-store",
      "Content-Type": "image/webp",
      "Content-Length": String(buffer.byteLength),
      "ETag": `"${image.contentHash}"`,
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if (error instanceof AmazonReadError) return Response.json({ error: error.message, code: error.businessCode }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
