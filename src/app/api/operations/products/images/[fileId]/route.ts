import { requireApiPermission } from "@/lib/auth/api-permissions";
import { amazonDataAccess } from "@/lib/amazon-sync/data-access";
import { readAccessibleProductImage } from "@/lib/operations/amazon-product-images";
import { getStorageDriver } from "@/lib/storage";
import { createS3PresignedGetUrl } from "@/lib/storage/s3-storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const permission = await requireApiPermission("operations", "view", request);
  if (!permission.ok) return permission.response;
  const { fileId } = await params;
  if (!/^[a-z0-9-]{20,64}$/i.test(fileId)) return new Response(null, { status: 404 });
  const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
  try {
    const access = await amazonDataAccess(scope, permission.user.id);
    const image = await readAccessibleProductImage(scope, fileId, access);
    if (!image || image.status !== "done" || image.mimeType !== "image/webp") return new Response(null, { status: 404 });
    if (image.storageType !== "local") {
      const url = await createS3PresignedGetUrl(image.storageKey, 600);
      return Response.redirect(url, 302);
    }
    const buffer = await getStorageDriver().getBoundedBuffer?.(image.storageKey, 2_000_000);
    if (!buffer) return new Response(null, { status: 503 });
    return new Response(new Uint8Array(buffer), { headers: {
      "Cache-Control": "private, no-cache",
      "Content-Type": "image/webp",
      "Content-Length": String(buffer.byteLength),
      "ETag": `"${image.contentHash}"`,
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
