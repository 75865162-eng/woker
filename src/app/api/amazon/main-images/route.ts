import { NextResponse } from "next/server";
import { requireAmazonReadSession } from "@/lib/auth/amazon-read-session";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { amazonDataAccess } from "@/lib/amazon-sync/data-access";
import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";
import { readMainImageUrlsByAsins, readMainImageUrlsByAsinOnly, type ImageProduct } from "@/lib/amazon-sync/main-image-query";

export const runtime = "nodejs";
const MAX_PRODUCTS = 2000;

/** Batch-resolve SP-API catalog main-image URLs for ASINs displayed on Amazon pages. */
export async function POST(request: Request) {
  try {
    const permission = await requireAmazonReadSession(request);
    if (!permission.ok) return permission.response;
    const body = (await request.json().catch(() => ({}))) as { products?: unknown; asins?: unknown };
    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);
    const tenantScope = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId };
    await auditAmazonDataRead(tenantScope, permission.user.id, "amazon/main-images", permission.user.role);
    const access = await amazonDataAccess(tenantScope, permission.user.id);

    // Loose mode: pages that expose only an ASIN. Resolve within all catalog sources visible to the caller.
    if (Array.isArray(body.asins)) {
      const asins = body.asins.filter((a): a is string => typeof a === "string" && /^[A-Z0-9]{10}$/.test(a)).slice(0, MAX_PRODUCTS);
      if (!asins.length) return NextResponse.json({ images: {} });
      const map = await readMainImageUrlsByAsinOnly(tenantScope, access, asins);
      return NextResponse.json({ images: Object.fromEntries(map) }, { headers: { "Cache-Control": "no-store" } });
    }

    const raw = Array.isArray(body.products) ? body.products : [];
    if (!raw.length || raw.length > MAX_PRODUCTS) return NextResponse.json({ images: {} });
    const products: ImageProduct[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const p = item as Record<string, unknown>;
      const sellerAccountId = typeof p.sellerAccountId === "string" ? p.sellerAccountId : "";
      const marketplaceId = typeof p.marketplaceId === "string" ? p.marketplaceId : "";
      const asin = typeof p.asin === "string" ? p.asin : "";
      if (!sellerAccountId || !marketplaceId || !/^[A-Z0-9]{10}$/.test(asin)) continue;
      products.push({ sellerAccountId, marketplaceId, asin });
    }
    if (!products.length) return NextResponse.json({ images: {} });

    const map = await readMainImageUrlsByAsins(tenantScope, access, products);
    return NextResponse.json({ images: Object.fromEntries(map) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Image enrichment is non-critical: never block the page; just return no images.
    return NextResponse.json({ images: {} }, { headers: { "Cache-Control": "no-store" } });
  }
}
