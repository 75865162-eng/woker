import { startAgentMeter, type PointsMeter } from "@/lib/points/usage";
import type { ChatScope } from "./types";

/**
 * 对话里付费外部数据源的积分计量。
 *
 * 约定与系统既有积分层一致（见 lib/points/usage.ts 影子模式）：
 * - 只有卖家精灵（sellersprite）与西柚（xiyou）的外部只读工具调用需要积分；
 *   Amazon / 赛狐 / Skill 发现与运行都不额外收费。
 * - 影子模式：默认只计量、不阻断；POINTS_ENFORCE=true 时余额不足会按既有机制拦截。
 *   所有异常都被积分层吞掉，计量永不成为对话的新故障源。
 * - requestKey 由 runId + 工具调用序号派生，重放不会重复扣分；结算单价走选品研究定价。
 */

export const PAID_CHAT_PROVIDERS = new Set(["sellersprite", "xiyou"]);

export function isPaidChatProvider(provider: string): boolean {
  return PAID_CHAT_PROVIDERS.has(provider);
}

export async function startPaidSourceMeter(input: {
  scope: ChatScope;
  provider: string;
  runId: string;
  seq: number;
}): Promise<PointsMeter | null> {
  if (!isPaidChatProvider(input.provider)) return null;
  return startAgentMeter({
    organizationId: input.scope.organizationId,
    userId: input.scope.userId,
    agentId: "market", // 选品研究定价（SELECTION_RESEARCH）
    requestKey: `chat-paid:${input.runId}:${input.seq}:${input.provider}`,
  });
}
