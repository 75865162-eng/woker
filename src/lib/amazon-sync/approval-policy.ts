import { sellerArchivePolicy, parseSellerArchivePolicy } from "./seller-archive-policy";
import { parseSettlementPolicy } from "./settlements";
import { parseObservationPolicy } from "./observation-policy";
import { parseReturnPolicy } from "./returns";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { SyncInputError, type SyncScope } from "./policy";
import { parseFinancePolicy } from "./finance";
import { parseOrderSyncPolicy } from "./orders";
export const operationTypes = {
  "save-access-grant": "ScopeBindingChange",
  "save-authorization": "CredentialChange", "disable-authorization": "CredentialChange",
  "save-source": "ScopeBindingChange", "save-plan": "SyncPolicyChange",
  "run": "SyncExecutionRequest", "control-task": "SyncExecutionRequest",
  "validate-authorization": "SyncExecutionRequest",
  "adopt-identity": "CredentialChange",
  "recover-finance-window": "SyncPolicyChange",
  "recover-report": "SyncPolicyChange",
} as const;
export type ChangeOperation = keyof typeof operationTypes;
export type ChangeType = typeof operationTypes[ChangeOperation];
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
export function digest(value: unknown) { return createHash("sha256").update(canonical(value)).digest("hex"); }
// Environment is chosen by the server. A staging/production override is a separately
// approved deployment configuration, never a client supplied environment selector.
export function targetEnvironment() {
  const value = process.env.AMAZON_DATA_CENTER_ENVIRONMENT || (process.env.NODE_ENV === "production" ? "production" : "local");
  if (!["local", "staging", "production"].includes(value)) throw new SyncInputError("Amazon 数据中心环境标识无效。", 503);
  return value;
}
export function operation(value: unknown): ChangeOperation {
  if (typeof value !== "string" || !Object.hasOwn(operationTypes, value)) throw new SyncInputError("未知操作。", 400);
  return value as ChangeOperation;
}
const allowed: Record<ChangeOperation, string[]> = {
  "save-access-grant": ["id", "proposedId", "revision", "userId", "roleId", "sellerAccountId", "enabled", "marketplaceIds", "actions", "mcpEnabled"],
  "save-authorization": ["id", "proposedId", "revision", "name", "amazonSellerId", "region", "endpoint", "lwaClientId", "lwaClientSecret", "refreshToken", "awsAccessKeyId", "awsSecretAccessKey", "awsSessionToken", "approvedRoles"],
  "disable-authorization": ["id", "revision"], "validate-authorization": ["id", "revision"],
  "adopt-identity": ["id", "revision", "amazonSellerId", "reviewedAt", "manifestDigest"],
  "recover-finance-window": ["id", "revision", "reviewedAt", "recoveryDigest", "sameWindowReplay"],
  "recover-report": ["id", "revision", "recoveryDigest", "reportWindow", "settlementPolicy", "attributionOnly"],
  "save-source": ["id", "proposedId", "revision", "authorizationId", "sellerAccountId", "marketplaceId", "resource", "freshnessMinutes", "enabled", "orderPolicy", "financePolicy", "returnsPolicy", "domainPolicy", "settlementPolicy"],
  "save-plan": ["id", "proposedId", "revision", "name", "resource", "enabled", "mode", "intervalMinutes", "priority", "maxAttempts", "retentionDays", "sourceIds"],
  "run": ["sourceIds", "planId", "datePreset", "dateFrom", "dateTo", "eventType", "reportWindows"], "control-task": ["id", "control"],
};
export function normalizeCommand(body: Record<string, unknown>) {
  const action = operation(body.action);
  if (body.importLegacy) throw new SyncInputError("旧凭证导入入口已关闭。", 410);
  const command: Record<string, unknown> = { action };
  for (const field of allowed[action]) if (body[field] !== undefined && body[field] !== "") command[field] = body[field];
  if (command.sameWindowReplay !== undefined && typeof command.sameWindowReplay !== "boolean") throw new SyncInputError("财务重放标识无效。");
  if (command.attributionOnly !== undefined && (typeof command.attributionOnly !== "boolean" || command.attributionOnly && (command.reportWindow !== undefined || command.settlementPolicy !== undefined))) throw new SyncInputError("归属复核不得同时改写报告窗口或结算策略。");
  if (command.settlementPolicy !== undefined) { if (command.resource !== "settlements" && action !== "recover-report") throw new SyncInputError("结算采集策略仅适用于结算域。"); command.settlementPolicy = parseSettlementPolicy(command.settlementPolicy); }
  if (command.domainPolicy !== undefined) command.domainPolicy = sellerArchivePolicy(String(command.resource), command.domainPolicy) ?? parseObservationPolicy(command.domainPolicy, typeof command.resource === "string" ? command.resource : undefined);
  if (command.returnsPolicy !== undefined) command.returnsPolicy = parseReturnPolicy(command.returnsPolicy);
  if (command.financePolicy !== undefined) command.financePolicy = parseFinancePolicy(command.financePolicy);
  if (command.orderPolicy !== undefined) command.orderPolicy = parseOrderSyncPolicy(command.orderPolicy);
  if (command.approvedRoles !== undefined && (!Array.isArray(command.approvedRoles) || command.approvedRoles.length > 30 || command.approvedRoles.some(role => typeof role !== "string" || !/^[A-Za-z][A-Za-z0-9 ()&/-]{0,99}$/.test(role)))) throw new SyncInputError("Amazon 角色集合格式无效。");
  if (action === "save-access-grant") {
    if (command.actions !== undefined && (!Array.isArray(command.actions) || command.actions.length > 4 || command.actions.some(a => typeof a !== "string" || !["view", "sync", "export", "edit"].includes(a)))) throw new SyncInputError("操作权限无效。");
    if (command.marketplaceIds !== undefined && (!Array.isArray(command.marketplaceIds) || command.marketplaceIds.length > 30 || command.marketplaceIds.some(m => typeof m !== "string" || !m || m.length > 200))) throw new SyncInputError("站点范围无效。");
    if (command.mcpEnabled !== undefined && typeof command.mcpEnabled !== "boolean") throw new SyncInputError("MCP 权限无效。");
  }
  if (command.sourceIds !== undefined) {
    if (!Array.isArray(command.sourceIds) || command.sourceIds.length < 1 || command.sourceIds.length > 100 || command.sourceIds.some(v => typeof v !== "string" || !v || v.length > 200)) throw new SyncInputError("请选择 1–100 个数据源。");
    command.sourceIds = [...new Set(command.sourceIds as string[])].sort();
  }
  if (Buffer.byteLength(JSON.stringify(command)) > 64000) throw new SyncInputError("请求超出安全长度限制。", 413);
  return command;
}
export function summary(command: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(command)) {
    if (["lwaClientId", "lwaClientSecret", "refreshToken", "awsAccessKeyId", "awsSecretAccessKey", "awsSessionToken"].includes(k)) { result[k] = v ? "将替换／新增" : "保留"; continue; }
    // Never accept arbitrary nested objects in summaries, even under a benign key.
    if (typeof v === "string") { if (v.length > 200) throw new SyncInputError("配置字段过长。"); result[k] = v; }
    else if (typeof v === "boolean" || typeof v === "number" || v === null) result[k] = v;
    else if (["requestedRanges", "orderWindows", "financeWindows", "returnWindows", "reportWindows", "reportWindow"].includes(k) && v && typeof v === "object" && !Array.isArray(v)) result[k] = v;
    else if (k === "settlementPolicy") result[k] = parseSettlementPolicy(v);
    else if (k === "domainPolicy") result[k] = v && typeof v === "object" && "mode" in v && v.mode === "seller-archive-only" ? parseSellerArchivePolicy(v) : parseObservationPolicy(v);
    else if (k === "returnsPolicy") result[k] = parseReturnPolicy(v);
    else if (k === "financePolicy") result[k] = parseFinancePolicy(v);
    else if (k === "orderPolicy") result[k] = parseOrderSyncPolicy(v);
    else if (["sourceIds", "marketplaceIds", "actions", "approvedRoles"].includes(k) && Array.isArray(v)) result[k] = v;
    else throw new SyncInputError("配置字段格式无效。");
  }
  return result;
}
export function safeState(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeState);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value)) {
    if (name === "accessEvidence") { result[name] = "API_ACCESS_EVIDENCE_REDACTED"; continue; }
    if (/(cipher|token|secret|password|authorizationheader|cookie|session)/i.test(name)) {
      result[name] = item ? "已配置" : "未配置";
    } else result[name] = safeState(item);
  }
  return result;
}
function key() {
  const value = process.env.AMAZON_SP_API_ENCRYPTION_KEY ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value, "base64").length !== 32) throw new SyncInputError("缺少有效的服务端加密密钥。", 503);
  return Buffer.from(value, "base64");
}
function aad(scope: SyncScope, id: string, environment: string) { return Buffer.from(canonical(["adc-command.v1", scope.organizationId, scope.workspaceId, id, environment])); }
export function seal(command: Record<string, unknown>, scope: SyncScope, id: string, environment: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv); cipher.setAAD(aad(scope, id, environment));
  return ["v1", iv.toString("base64url"), Buffer.concat([cipher.update(JSON.stringify(command)), cipher.final()]).toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}
export function unseal(value: string, scope: SyncScope, id: string, environment: string): Record<string, unknown> {
  try {
    const [v, iv, data, tag, extra] = value.split("."); if (v !== "v1" || !iv || !data || !tag || extra) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url")); cipher.setAAD(aad(scope, id, environment)); cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data, "base64url")), cipher.final()]).toString("utf8"));
  } catch { throw new SyncInputError("待应用配置无法解密，已阻止应用。", 409); }
}
// Self-confirmation eligibility is resolved from live server-side membership after RBAC checks.
export function assertDecision(row: { status: string; requestedByUserId: string; expiresAt: Date }, actor: string, now = new Date(), allowSelfApproval = false) {
  if (row.status !== "REQUESTED" || row.expiresAt <= now) throw new SyncInputError("审批已处理或过期。", 409);
  if (row.requestedByUserId === actor && !allowSelfApproval) throw new SyncInputError("仅组织所有者或数据库管理员可确认自己的请求，且须具备审批权限。", 403);
}
export function assertApplicable(row: { status: string; expiresAt: Date; targetEnvironment: string; changeDigest: string; baseRevision: number; approvedByUserId: string | null }, expected: { environment: string; digest: string; revision: number }, now = new Date()) {
  if (row.status !== "APPROVED" || !row.approvedByUserId || row.expiresAt <= now || row.targetEnvironment !== expected.environment || row.changeDigest !== expected.digest || row.baseRevision !== expected.revision) throw new SyncInputError("审批已失效、已使用或变更范围不匹配。", 409);
}
