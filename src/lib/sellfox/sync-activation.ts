import { prisma } from "@/lib/db/prisma";
import { SellfoxCredentialError, type SellfoxCredentialScope } from "./credential-crypto";
import { resolveSellfoxCredentials } from "./credential-store";
import { SellfoxRequestError, testSellfoxConnection } from "./client";
import { bootstrapSellfoxStores, planSellfoxFullSync } from "./sync-orchestrator";

export type SellfoxActivationResult = {
  activated: boolean;
  connected: boolean;
  storesStarted: boolean;
  /** 本次自动铺开的全量任务数（幂等跳过的不计）。 */
  fullSyncCreated: number;
  /** 全量计划未能铺开的原因；null 表示成功。失败不影响凭据与店铺同步。 */
  fullSyncError: string | null;
  message: string;
};

/**
 * 凭据保存成功后的自动激活编排（P0 核心）。
 *
 * 流程：真实调用赛狐 Token 端点验证连通性 → 凭据有效则激活本工作区同步配置 →
 * 先建 stores 初始化任务，再立即铺开全量计划（所有内置域 + 已启用端点）。
 *
 * 全量计划里的非 stores 任务会因「店铺未就绪」进入 waiting_dependency，
 * stores 成功落库后由 wakeWaitingDependents 按原冻结窗口依依赖顺序唤醒执行，
 * 从而实现「一配置好 API 就全量拉取并永久落库」，无需人工点一键全量或手工补调度。
 *
 * 全量铺开失败与凭据保存解耦：凭据已加密落库、stores 已入队，任何计划异常只记录到
 * 审计并返回给前端，不回滚凭据、不把已连通信任判为失败。
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

  // 凭据校验通过即铺开全量计划：所有内置域 + 已启用端点，按依赖顺序分块入队。
  // 非 stores 任务在店铺就绪前进入 waiting_dependency，stores 成功后自动唤醒，
  // 实现「配置好 API 马上全量拉取并永久落库」，无需人工补调度。
  let fullSyncCreated = 0;
  let fullSyncError: string | null = null;
  try {
    const plan = await planSellfoxFullSync({ ...scope, userId: actor }, { trigger: "credential_bootstrap_full" });
    fullSyncCreated = plan.created;
  } catch (error) {
    fullSyncError = error instanceof Error ? error.message : "全量计划铺开失败";
    console.error(JSON.stringify({
      scope: "sellfox.sync.activation.fullsync",
      organizationId: scope.organizationId, workspaceId: scope.workspaceId,
      message: fullSyncError,
    }));
  }

  await prisma.auditLog.create({
    data: {
      organizationId: scope.organizationId,
      userId: actor,
      entityType: "sellfox_integration_credential",
      entityId: JSON.stringify([scope.organizationId, scope.workspaceId]),
      action: connected && (started.started || fullSyncCreated > 0) ? "sellfox.sync.activated" : "sellfox.sync.activation_skipped",
      metadata: { workspaceId: scope.workspaceId, revision, connected, storesStarted: started.started, storesRunId: started.runId ?? null, fullSyncCreated, fullSyncError },
    },
  });

  let resultMessage = started.started ? message : "凭据校验通过；店铺同步任务已在队列中或已完成，未重复创建。";
  if (fullSyncError) resultMessage += ` 全量拉取计划尚未铺开（${fullSyncError}），可在同步控制台手动触发一键全量。`;
  else if (fullSyncCreated > 0) resultMessage += ` 已铺开 ${fullSyncCreated} 个全量拉取任务，数据将自动落地数据库。`;

  return {
    activated: connected && (started.started || fullSyncCreated > 0),
    connected,
    storesStarted: started.started,
    fullSyncCreated,
    fullSyncError,
    message: resultMessage,
  };
}
