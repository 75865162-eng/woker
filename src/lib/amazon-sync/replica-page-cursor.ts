import { createHmac, timingSafeEqual } from "node:crypto";
import { cloudRelayConfiguration } from "@/lib/amazon/cloud-relay-protocol";
import { digest } from "./approval-policy";
import { SyncInputError, type SyncScope } from "./policy";
export type ReplicaPageCursor = { version: 1; binding: string; generation: string; after: string; expiresAt: number };
export function replicaPageCursorBinding(scope: SyncScope, actor: string, sourceId: string, revision: number, resource: "finance" | "orders" = "finance") {
  return digest([scope.organizationId, scope.workspaceId, actor, sourceId, revision, cloudRelayConfiguration().endpoint, ...(resource === "finance" ? [] : [resource])]);
}
function signature(body: string, resource: "finance" | "orders") { return createHmac("sha256", cloudRelayConfiguration().secret).update(`${resource}-replica-page.v1:${body}`).digest(); }
export function sealReplicaPageCursor(value: ReplicaPageCursor, resource: "finance" | "orders" = "finance") {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${signature(body, resource).toString("hex")}`;
}
export function openReplicaPageCursor(token: unknown, binding: string, generation: string, now = Date.now(), resource: "finance" | "orders" = "finance"): ReplicaPageCursor {
  const invalid = (): never => { throw new SyncInputError(`${resource === "finance" ? "财务" : "订单"}分批回传进度已失效或云端数据已变化，请从首批重新回传；已入库数据保留。`, 409); };
  if (typeof token !== "string" || token.length > 2048) return invalid();
  const [body, mac, extra] = token.split(".");
  if (extra !== undefined || !body || !/^[a-f0-9]{64}$/.test(mac ?? "") || !timingSafeEqual(signature(body, resource), Buffer.from(mac, "hex"))) return invalid();
  let cursor: ReplicaPageCursor;
  try { cursor = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return invalid(); }
  if (!cursor || cursor.version !== 1 || cursor.binding !== binding || cursor.generation !== generation || typeof cursor.after !== "string" || !cursor.after.length || cursor.after.length > 500 || !Number.isSafeInteger(cursor.expiresAt) || cursor.expiresAt <= now || cursor.expiresAt > now + 1800000) return invalid();
  return cursor;
}
