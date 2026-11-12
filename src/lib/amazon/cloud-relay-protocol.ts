import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { canonical } from "@/lib/amazon-sync/approval-policy";
import { SyncInputError, type SyncScope } from "@/lib/amazon-sync/policy";

export const cloudRelayPath = "/api/internal/amazon/execution";
export class AmazonCloudRelayError extends SyncInputError {
  constructor(readonly code: "CLOUD_NOT_CONFIGURED" | "CLOUD_REQUEST_REJECTED" | "CLOUD_RESULT_UNKNOWN", message: string, status = 409) { super(message, status); }
}
export type CloudRelayOperation = { kind: "request"; command: Record<string, unknown> } | { kind: "list" } | { kind: "inventory-replica"; sourceId: string } | { kind: "catalog-replica"; sourceId: string } | { kind: "ads-entities-replica"; profileRecordId: string } | { kind: "ads-reports-replica"; profileRecordId: string } | { kind: "orders-replica"; sourceId: string } | { kind: "orders-replica-page"; sourceId: string; cursor?: string } | { kind: "finance-replica"; sourceId: string } | { kind: "finance-replica-page"; sourceId: string; cursor?: string } | { kind: "apply"; id: string } | { kind: "decide"; id: string; decision: "APPROVED" | "REJECTED" | "REVOKED"; reason: string };
export type CloudRelayEnvelope = { version: 1; audience: string; scope: SyncScope; actorUserId: string; requestId: string; issuedAt: number; operation: CloudRelayOperation };

export function cloudRelayConfiguration() {
  const secret = process.env.AMAZON_CLOUD_BRIDGE_SECRET ?? "";
  let base: URL;
  try { base = new URL(process.env.AMAZON_CLOUD_EXECUTOR_URL ?? ""); } catch { throw new AmazonCloudRelayError("CLOUD_NOT_CONFIGURED", "尚未配置云端执行服务；未在本地创建正式同步任务。", 503); }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/" || !/^[a-z0-9.-]+$/i.test(base.hostname) || /^(?:localhost|[\d.]+)$/i.test(base.hostname) || /\.(?:localhost|local)$/i.test(base.hostname) || secret.length < 32 || secret.length > 4096) {
    throw new AmazonCloudRelayError("CLOUD_NOT_CONFIGURED", "云端执行地址或服务凭证配置无效。", 503);
  }
  return { endpoint: new URL(cloudRelayPath, base).href, secret };
}
export function createCloudRelayEnvelope(scope: SyncScope, actorUserId: string, operation: CloudRelayOperation, now = Date.now()): CloudRelayEnvelope {
  return { version: 1, audience: cloudRelayConfiguration().endpoint, scope: { organizationId: scope.organizationId, workspaceId: scope.workspaceId }, actorUserId, requestId: randomUUID(), issuedAt: now, operation };
}
export function cloudRelaySignature(envelope: CloudRelayEnvelope) {
  return createHmac("sha256", cloudRelayConfiguration().secret).update(canonical(envelope)).digest("hex");
}
export function verifyCloudRelayEnvelope(value: Record<string, unknown>, signature: string | null, now = Date.now()): CloudRelayEnvelope {
  const reject = (): never => { throw new AmazonCloudRelayError("CLOUD_REQUEST_REJECTED", "云端执行请求认证无效或已过期。", 401); };
  if (!signature || !/^[a-f0-9]{64}$/.test(signature)) return reject();
  const expected = createHmac("sha256", cloudRelayConfiguration().secret).update(canonical(value)).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return reject();
  const text = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 200;
  const scope = value.scope as Record<string, unknown> | undefined;
  if (value.version !== 1 || value.audience !== cloudRelayConfiguration().endpoint || !Number.isSafeInteger(value.issuedAt) || Math.abs(now - Number(value.issuedAt)) > 120_000
    || !text(value.requestId) || !text(value.actorUserId) || !scope || !text(scope.organizationId) || !text(scope.workspaceId)) return reject();
  const op = value.operation as Record<string, unknown> | undefined;
  if (!op || !["request", "list", "apply", "decide", "inventory-replica", "catalog-replica", "ads-entities-replica", "ads-reports-replica", "orders-replica", "finance-replica", "finance-replica-page", "orders-replica-page"].includes(String(op.kind))) return reject();
  if (["ads-entities-replica", "ads-reports-replica"].includes(String(op.kind)) && !text(op.profileRecordId)) return reject();
  if (["inventory-replica", "catalog-replica", "orders-replica", "finance-replica", "finance-replica-page", "orders-replica-page"].includes(String(op.kind)) && !text(op.sourceId)) return reject();
  if (["finance-replica-page", "orders-replica-page"].includes(String(op.kind)) && op.cursor !== undefined && (typeof op.cursor !== "string" || !op.cursor.length || op.cursor.length > 2048)) return reject();
  if (op.kind === "request" && (!op.command || typeof op.command !== "object" || Array.isArray(op.command) || (op.command as Record<string, unknown>).action !== "run")) return reject();
  if (["apply", "decide"].includes(String(op.kind)) && !text(op.id)) return reject();
  if (op.kind === "decide" && (!["APPROVED", "REJECTED", "REVOKED"].includes(String(op.decision)) || typeof op.reason !== "string" || op.reason.length > 200)) return reject();
  return value as unknown as CloudRelayEnvelope;
}
