import { prisma } from "@/lib/db/prisma";
import { amazonCloudExecutionEnabled } from "@/lib/amazon/execution-role";
import { AmazonCloudRelayError, cloudRelayConfiguration, createCloudRelayEnvelope, cloudRelaySignature, type CloudRelayOperation } from "@/lib/amazon/cloud-relay-protocol";
import { amazonDataAccess, sellerAccessWhere } from "./data-access";
import { normalizeCommand } from "./approval-policy";
import { SyncInputError, type SyncScope } from "./policy";

export const cloudRelayConfigured = () => Boolean(process.env.AMAZON_CLOUD_EXECUTOR_URL);
export async function relayAmazonExecution(scope: SyncScope, actor: string, operation: CloudRelayOperation, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> {
  if (amazonCloudExecutionEnabled()) throw new SyncInputError("云端不能再次转发执行请求。", 409);
  const { endpoint } = cloudRelayConfiguration();
  // Live local access also enforces any enclosing MCP mutation credential fence.
  const access = await amazonDataAccess(scope, actor);
  if (operation.kind === "request") {
    const command = normalizeCommand(operation.command);
    if (command.action !== "run" || !Array.isArray(command.sourceIds)) throw new SyncInputError("云端转发仅支持同步申请。", 400);
    const sources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, ...sellerAccessWhere(access), id: { in: command.sourceIds as string[] } }, select: { id: true } });
    if (sources.length !== command.sourceIds.length) throw new SyncInputError("同步来源超出当前账号权限。", 403);
    operation = { kind: "request", command };
  }
  const envelope = createCloudRelayEnvelope(scope, actor, operation);
  let response: Response;
  try { response = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Amazon-Cloud-Signature": cloudRelaySignature(envelope) }, body: JSON.stringify(envelope), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000) }); }
  catch { throw new AmazonCloudRelayError("CLOUD_RESULT_UNKNOWN", "云端响应未确认，请查询云端审批与任务状态；未回退到本地执行。", 502); }
  const reader = response.body?.getReader();
  if (!reader) throw new AmazonCloudRelayError("CLOUD_RESULT_UNKNOWN", "云端响应缺失，请核对任务状态。", 502);
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 512 * 1024) { await reader.cancel(); throw new Error(); } chunks.push(part.value); }
  } catch { throw new AmazonCloudRelayError("CLOUD_RESULT_UNKNOWN", "云端响应不完整，请核对任务状态。", 502); }
  finally { reader.releaseLock(); }
  let result: Record<string, unknown>;
  try { result = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error(); }
  catch { throw new AmazonCloudRelayError("CLOUD_RESULT_UNKNOWN", "云端响应格式无效，请核对任务状态。", 502); }
  if (!response.ok) throw new AmazonCloudRelayError("CLOUD_REQUEST_REJECTED", "云端拒绝执行请求；请检查当前账号分配、审批状态、授权及配置版本。", [400, 401, 403, 404, 409, 428, 503].includes(response.status) ? response.status : 502);
  if (result.requestId !== envelope.requestId || result.executionLocation !== "cloud") throw new AmazonCloudRelayError("CLOUD_RESULT_UNKNOWN", "云端响应身份不匹配，请核对任务状态。", 502);
  await amazonDataAccess(scope, actor);
  return result;
}
