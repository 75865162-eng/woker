import { prisma } from "@/lib/db/prisma";
import { SellfoxCredentialError, type SellfoxCredentialScope } from "./credential-crypto";
import { resolveSellfoxCredentials } from "./credential-store";
import { SellfoxRequestError, testSellfoxConnection } from "./client";
import { bootstrapSellfoxStores } from "./sync-orchestrator";

export type SellfoxActivationResult = {
  activated: boolean;
  connected: boolean;
  storesStarted: boolean;
  message: string;
};

/**
 * 凭据保存成功后的自动激活编排（P0 核心）。
 *
 * 流程：真实调用赛狐 Token 端点验证连通性 → 凭据有效则激活本工作区同步配置 →
 * 幂等创建 stores 初始化任务并入队。下游数据域由 stores 成功后的依赖唤醒触发。
 *
 * 鉴权失败会明确区分于「没有店铺」：Token 端点只判断凭据是否有效，
 * 店铺数为 0 是待 stores 同步发现的正常状态，不作为凭据错误。
 */
export async function activateSellfoxSyncAfterSave(scope: SellfoxCredentialScope, actor: string, revision: number): Promise<SellfoxActivationResult> {
  const credentials = await resolveSellfoxCredentials(scope);

  let connected = false;
  let message: string;
  try {
    await testSellfoxConnection(credentials);
    connected = true;
    message = "凭据校验通过，已自动激活同步；正在同步店铺主数据，随后将按依赖顺序自动拉取其余数据域。";
  } catch (error) {
    if (error instanceof SellfoxRequestError) throw new SellfoxCredentialError(`赛狐凭据校验失败：${error.message} 请检查 Client ID / Secret 与 IP 白名单后重新保存。`, 400);
    throw new SellfoxCredentialError("赛狐凭据连通性验证未完成，未启动同步。请稍后重试；凭据已加密保存。", 503);
  }

  const started = await bootstrapSellfoxStores({ ...scope, userId: actor });
  await prisma.auditLog.create({
    data: {
      organizationId: scope.organizationId,
      userId: actor,
      entityType: "sellfox_integration_credential",
      entityId: JSON.stringify([scope.organizationId, scope.workspaceId]),
      action: connected && started.started ? "sellfox.sync.activated" : "sellfox.sync.activation_skipped",
      metadata: { workspaceId: scope.workspaceId, revision, connected, storesStarted: started.started, storesRunId: started.runId ?? null },
    },
  });

  return {
    activated: connected && started.started,
    connected,
    storesStarted: started.started,
    message: started.started ? message : "凭据校验通过；店铺同步任务已在队列中或已完成，未重复创建。",
  };
}
