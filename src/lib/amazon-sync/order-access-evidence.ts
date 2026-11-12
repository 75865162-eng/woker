import { decryptCheckpoint, encryptCheckpoint } from "./checkpoint";
import { SyncInputError, type SyncScope } from "./policy";
export type OrderAccessContext = SyncScope & { authorizationId: string; authorizationRevision: number; marketplaceId: string; includedData?: readonly string[] };
const binding = (c: OrderAccessContext) => JSON.stringify(["order-items-api-access.v1", c.authorizationId, c.authorizationRevision, c.marketplaceId, "getOrder", [...new Set(c.includedData ?? [])].sort()]);
/** Proof binds the exact getOrder request datasets. Empty/default datasets retain
 * the existing core-only binding. A successful response never attests a role or
 * guarantees optional monetary/PII fields were returned. */
export function orderAccessEvidence(context: OrderAccessContext, response: { status: number; parsed: boolean; requestId: string | null }, now = new Date()) {
  if (response.status !== 200 || !response.parsed || !response.requestId) throw new SyncInputError("订单商品接口能力证据不完整。", 403);
  return encryptCheckpoint(JSON.stringify({ ...response, checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86400000).toISOString() }), context, binding(context))!;
}
export function assertOrderAccessEvidence(value: string, context: OrderAccessContext, now = new Date()) {
  try {
    const proof = JSON.parse(decryptCheckpoint(value, context, binding(context))!);
    const checked = Date.parse(proof.checkedAt), expires = Date.parse(proof.expiresAt);
    if (proof.status !== 200 || proof.parsed !== true || typeof proof.requestId !== "string" || !proof.requestId || !Number.isFinite(checked) || !Number.isFinite(expires) || checked > now.getTime() || expires <= now.getTime() || expires - checked !== 86400000) throw new Error();
  } catch { throw new SyncInputError("订单商品接口能力证据缺失、过期或授权/站点/请求数据范围已变化，须重新受控核验。", 403); }
}
