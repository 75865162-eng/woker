import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { loadActivePriceRule } from "./policy";
import { releasePoints, reservePoints, settlePoints } from "./spend";

/**
 * Agent 执行点的积分计量（影子模式）。
 *
 * 设计取舍：
 * 1. **永不阻断业务**。默认 `POINTS_ENFORCE` 未开时，余额不足、表缺失、任何异常都只记 warn，
 *    调用方继续跑。定价表还是推断值，先收真实消耗分布，再决定是否强制拦截。
 * 2. **计量口径**：一个 Agent 执行（一次 runtime.run）= 一次单价（unitCost），
 *    reserve 时按 maxCost 冻结做上限保护，结算退回差额。
 * 3. **幂等**：requestKey 由 executionId 派生，重放不会重复扣分。
 */

const AGENT_OPERATION_CODES: Record<string, string> = {
  market: "SELECTION_RESEARCH",
  listing: "LISTING_GENERATE",
  product: "AGENT_RUN",
  supplier: "AGENT_RUN",
  ppc: "AGENT_RUN",
  orchestrator: "AGENT_RUN",
  "platform-runtime-core": "AGENT_RUN",
};

/** 未在映射表里的 agent 一律按通用任务计价，不静默免费。 */
export function operationCodeForAgent(agentId: string): string {
  return AGENT_OPERATION_CODES[agentId] ?? "AGENT_RUN";
}

/** 强制拦截开关。默认关闭：只记录不阻断。 */
export function pointsEnforcementEnabled(): boolean {
  return process.env.POINTS_ENFORCE === "true";
}

export type PointsMeter = {
  /** 结算。调用失败不抛，返回 null。 */
  settle: (executionId?: string | null) => Promise<{ charged: number } | null>;
  /** 主动释放（任务失败/中止时用）。失败不抛。 */
  release: () => Promise<void>;
  /** 预扣是否真的发生（false 表示跳过计量，如余额不足或表未就绪）。 */
  reserved: boolean;
  /** 本次预扣的 requestKey，便于日志追踪。 */
  requestKey: string;
  /** 跳过原因，用于日志与调试。 */
  skipReason?: string;
};

const noopMeter = (requestKey: string, skipReason: string): PointsMeter => ({
  reserved: false,
  requestKey,
  skipReason,
  settle: async () => null,
  release: async () => undefined,
});

/**
 * 在 Agent 执行前调用。返回 meter，执行结束后必须调 settle 或 release。
 *
 * 注意：这里吞掉所有异常是**有意**的。影子期积分系统不能成为业务的新故障源。
 */
export async function startAgentMeter(input: {
  organizationId: string;
  userId: string;
  agentId: string;
  requestKey?: string;
}): Promise<PointsMeter> {
  const requestKey = input.requestKey ?? `agent-${input.agentId}-${randomUUID()}`;
  const operationCode = operationCodeForAgent(input.agentId);

  try {
    const reserved = await reservePoints({
      organizationId: input.organizationId,
      userId: input.userId,
      operationCode,
      requestKey,
      createdById: input.userId,
    });

    if (reserved.free || reserved.cost === 0) {
      // 定价为 0 的操作（如批量导入）不占用额度，但仍记一条流水便于统计。
      return {
        reserved: true,
        requestKey,
        settle: async () => ({ charged: 0 }),
        release: async () => undefined,
      };
    }

    return {
      reserved: true,
      requestKey,
      settle: async () => {
        try {
          const rule = await loadActivePriceRule(prisma, input.organizationId, operationCode);
          // 单价即一次执行的实耗；查不到定价时按冻结额结清，避免白跑。
          const actualCost = rule ? rule.unitCost : reserved.cost;
          const result = await settlePoints({
            organizationId: input.organizationId,
            userId: input.userId,
            requestKey,
            actualCost,
            createdById: input.userId,
          });
          return { charged: result.charged };
        } catch (error) {
          console.warn("[points] 结算失败（影子模式，不影响执行）", { requestKey, operationCode, error });
          return null;
        }
      },
      release: async () => {
        try {
          await releasePoints({
            organizationId: input.organizationId,
            userId: input.userId,
            requestKey,
            createdById: input.userId,
          });
        } catch (error) {
          console.warn("[points] 释放预扣失败（影子模式，不影响执行）", { requestKey, error });
        }
      },
    };
  } catch (error) {
    if (pointsEnforcementEnabled()) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("[points] 跳过计量（影子模式，不影响执行）", { requestKey, operationCode, reason });
    return noopMeter(requestKey, reason);
  }
}
