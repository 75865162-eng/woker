import type { Run, SkillSnapshot, ToolDefinition, ToolPolicy } from "./types";

/** Only the spending cap is simulated. Never infer provider credits from request count. */
export function researchBudgetPreview(input: {
  skills: SkillSnapshot[]; registry: ToolDefinition[]; policies: Record<string, ToolPolicy>;
  limits: Record<string, number>; budgetMode?: "reviewed" | "mock_unlimited";
  pendingAction?: Run["pendingAction"]; pendingActionApproved?: boolean;
}) {
  const unlimited = input.budgetMode === "mock_unlimited";
  return {
    mode: input.budgetMode ?? "reviewed", simulated: unlimited,
    message: unlimited
      ? "预算估算暂用无限额度 mock；真实市场数据仍需授权。积分、金额未知，不代表免费或供应商额度无限。"
      : "调用次数与积分分别计量；没有供应商计费规则的费用保持未知。",
    stages: input.skills.map((skill, index) => ({
      stage: index + 1, skill: skill.name, skillSha256: skill.sha256,
      // A policy ceiling is a safety limit, never a forecast of calls the AI will actually make.
      estimatedCalls: null, credits: null, money: null,
      tools: input.registry.filter(tool => input.policies[tool.name]?.stages.includes(index + 1)).map(tool => {
        const policy = input.policies[tool.name];
        return { name: tool.name, provider: policy.provider, paid: policy.paid,
          callLimit: unlimited ? null : policy.maxCalls, unit: policy.unit,
          pricingSource: policy.pricingSource };
      }),
    })),
    pendingCall: input.pendingAction ? {
      tool: input.pendingAction.tool, arguments: input.pendingAction.arguments,
      estimatedCalls: 1, estimatedCost: null, costStatus: "unknown",
      provider: input.policies[input.pendingAction.tool]?.provider ?? null,
      approved: input.pendingActionApproved === true,
      message: "本次拟执行 1 次工具调用；供应商实际费用未知，不表示免费。",
    } : null,
    providerLimits: Object.fromEntries(Object.entries(input.limits).map(([provider, limit]) => [provider, unlimited ? null : limit])),
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
