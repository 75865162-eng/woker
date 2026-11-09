import { researchCallPlan } from "./call-plan";
import { researchCreditRule, researchCreditUsage } from "./credits";
import type { Run, SkillSnapshot, ToolDefinition, ToolPolicy } from "./types";

/** Only the spending cap is simulated. Never infer provider credits from request count. */
export function researchBudgetPreview(input: {
  skills: SkillSnapshot[]; registry: ToolDefinition[]; policies: Record<string, ToolPolicy>;
  limits: Record<string, number>; budgetMode?: "reviewed" | "mock_unlimited" | "uncapped";
  pendingAction?: Run["pendingAction"]; pendingActionApproved?: boolean; paidCallAuthorization?: Run["paidCallAuthorization"];
}) {
  const simulated = input.budgetMode === "mock_unlimited";
  const unlimited = simulated || input.budgetMode === "uncapped";
  return {
    mode: input.budgetMode ?? "reviewed", simulated,
    message: simulated
      ? "预算估算暂用无限额度 mock；真实市场数据仍需授权。积分、金额未知，不代表免费或供应商额度无限。"
      : "规划调用约18–30次，仅为单站点、一个细分市场的估算；研究服务费用统一折算研究积分（1积分=¥0.01），未知价格待核实。任务默认不限次数，账户余额和权限仍独立校验。",
    creditRule: researchCreditRule,
    planning: { version: 1, source: "host_workflow_estimate", assumptions: "一个站点、最终研究一个细分市场、3–5个竞品；不是供应商报价或硬上限", calls: { min: 18, max: 30 } },
    stages: input.skills.map((skill, index) => ({
      stage: index + 1, skill: skill.name, skillSha256: skill.sha256,
      // A policy ceiling is a safety limit, never a forecast of calls the AI will actually make.
      estimatedCalls: simulated ? null : researchCallPlan.find(plan => plan.skill === skill.name) ?? null, credits: null, money: null,
      tools: input.registry.filter(tool => input.policies[tool.name]?.stages.includes(index + 1)).map(tool => {
        const policy = input.policies[tool.name];
        return { name: tool.name, provider: policy.provider, paid: policy.paid,
          callLimit: unlimited ? null : policy.maxCalls, unit: policy.unit,
          pricingSource: policy.pricingSource };
      }),
    })),
    pendingCall: input.pendingAction ? {
      tool: input.pendingAction.tool, arguments: input.pendingAction.arguments,
      estimatedCalls: 1, estimatedCredits: null, estimatedCost: null, costStatus: "pending_verification",
      provider: input.policies[input.pendingAction.tool]?.provider ?? null,
      approved: input.pendingActionApproved === true,
      message: "本次拟执行 1 次工具调用；研究积分待核实，不表示免费。",
    } : null,
    providerLimits: Object.fromEntries(Object.entries(input.limits).map(([provider, limit]) => [provider, unlimited ? null : limit])),
    paidCallAuthorization: input.paidCallAuthorization ? {
      budgetMode: input.paidCallAuthorization.budgetMode ?? "reviewed", id: input.paidCallAuthorization.id, approvedAt: input.paidCallAuthorization.approvedAt,
      approvedByUserId: input.paidCallAuthorization.approvedByUserId,
      approvedActionDigest: input.paidCallAuthorization.approvedActionDigest,
      providerLimits: input.paidCallAuthorization.providerLimits,
      toolLimits: input.paidCallAuthorization.toolLimits,
    } : null,
    unknownCosts: ["实际市场请求次数由研究过程确定", "供应商实际积分与金额", "AI 模型费用"],
  };
}

export function researchUsage(run: Pick<Run, "calls">) {
  const providers: Record<string, { calls: number; unknownBillingCalls: number; confirmedCredits: number; unknownCreditCalls: number }> = {};
  for (const call of run.calls) {
    if (!call.paid || call.dispatch === "NOT_SENT") continue;
    const entry = providers[call.provider] ??= { calls: 0, unknownBillingCalls: 0, confirmedCredits: 0, unknownCreditCalls: 0 };
    entry.calls++;
    if (call.billing === "UNKNOWN") entry.unknownBillingCalls++;
    // Legacy records have no billing unit; they cannot establish a credit amount.
    const unit = call.billingUnit;
    if (call.billing === "CONFIRMED" && unit === "credits") entry.confirmedCredits += call.knownUnits ?? 0;
    else entry.unknownCreditCalls++;
  }
  return providers;
}

export { researchCreditUsage };
