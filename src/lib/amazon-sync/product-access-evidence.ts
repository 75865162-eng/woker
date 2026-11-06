import { decryptCheckpoint, encryptCheckpoint } from "./checkpoint";
import { SyncInputError, type SyncScope } from "./policy";
export type ProductAccessContext = SyncScope & { authorizationId: string; authorizationRevision: number; marketplaceId: string; resource: "listing_details" | "catalog_items" };
const binding = (c: ProductAccessContext) => JSON.stringify(["product-api-access.v1", c.authorizationId, c.authorizationRevision, c.marketplaceId, c.resource]);
/** Server-only evidence of parsed HTTP 200, never an Amazon role claim. */
export function productAccessEvidence(context: ProductAccessContext, response: { status: number; parsed: boolean; requestId: string | null }, now = new Date()) {
  if (response.status !== 200 || !response.parsed || !response.requestId) throw new SyncInputError("详情接口能力证据不完整。", 403);
  return encryptCheckpoint(JSON.stringify({ ...response, checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86400000).toISOString() }), context, binding(context))!;
}
export function assertProductAccessEvidence(value: string, context: ProductAccessContext, now = new Date()) {
  try {
    const proof = JSON.parse(decryptCheckpoint(value, context, binding(context))!);
    const checked = Date.parse(proof.checkedAt), expires = Date.parse(proof.expiresAt);
    if (proof.status !== 200 || proof.parsed !== true || typeof proof.requestId !== "string" || !proof.requestId || !Number.isFinite(checked) || !Number.isFinite(expires) || checked > now.getTime() || expires <= now.getTime() || expires - checked !== 86400000) throw new Error();
  } catch { throw new SyncInputError("详情接口能力证据缺失、过期或授权/站点已变化，须重新受控核验。", 403); }
}
