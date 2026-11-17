import type { AgentEvaluationCase, JsonValue } from "./types";
import type { PpcExecutionRequest } from "./ppc-contracts";
import { ppcAgentId } from "./ppc-constants";

export const ppcEvaluationCases: AgentEvaluationCase[] = [
  evaluationCase("ppc-case-01", "High ACOS diagnosis", {
    naturalLanguageGoal: "诊断 ACOS 偏高的广告组并给出调价建议",
    marketplace: "US",
    targetAcos: 30,
  }, {
    shouldDiagnoseWaste: true,
    shouldProduceBidReduction: true,
    shouldSurfaceEvidence: true,
  }),
  evaluationCase("ppc-case-02", "Low ACOS scale", {
    naturalLanguageGoal: "找出可以加预算的高效关键词",
    marketplace: "US",
    targetAcos: 25,
  }, {
    shouldIdentifyScalingOpportunity: true,
    shouldProduceBidIncrease: true,
  }),
  evaluationCase("ppc-case-03", "Negative keyword opportunity", {
    naturalLanguageGoal: "找出该加否定词的浪费流量",
    marketplace: "US",
  }, {
    shouldProduceNegativeKeywords: true,
  }),
  evaluationCase("ppc-case-04", "Campaign cleanup", {
    naturalLanguageGoal: "建议拆分广告结构",
    marketplace: "US",
  }, {
    shouldRecommendCampaignRestructure: true,
  }),
  evaluationCase("ppc-case-05", "Sparse data", {
    naturalLanguageGoal: "只有少量点击的数据也要给建议",
    marketplace: "US",
  }, {
    shouldHandleSparseSignals: true,
  }),
  evaluationCase("ppc-case-06", "No orders", {
    naturalLanguageGoal: "找零订单高花费词",
    marketplace: "US",
  }, {
    shouldDetectZeroOrderWaste: true,
  }),
  evaluationCase("ppc-case-07", "Product context aware", {
    naturalLanguageGoal: "结合产品卖点做 PPC 建议",
    marketplace: "US",
  }, {
    shouldUseProductContext: true,
  }),
  evaluationCase("ppc-case-08", "SellerSprite aware", {
    naturalLanguageGoal: "结合 SellerSprite 关键词做 PPC 建议",
    marketplace: "US",
  }, {
    shouldUseKeywordSignals: true,
  }),
  evaluationCase("ppc-case-09", "Workspace scope", {
    naturalLanguageGoal: "只看当前工作区的广告组",
    marketplace: "US",
  }, {
    shouldRespectWorkspaceScope: true,
  }),
  evaluationCase("ppc-case-10", "Human approval bundle", {
    naturalLanguageGoal: "把建议打包成审批",
    marketplace: "US",
  }, {
    shouldRequireHumanApproval: true,
  }),
  evaluationCase("ppc-case-11", "High risk campaign change", {
    naturalLanguageGoal: "建议大幅调整竞价和结构",
    marketplace: "US",
  }, {
    shouldEscalateRisk: true,
  }),
  evaluationCase("ppc-case-12", "Evidence trace", {
    naturalLanguageGoal: "每个结论都要能追踪到工具和指标",
    marketplace: "US",
  }, {
    shouldReturnEvidenceTrace: true,
  }),
];

export function evaluationCase(
  id: string,
  name: string,
  input: PpcExecutionRequest,
  expectedBehavior: Record<string, JsonValue>,
): AgentEvaluationCase {
  const now = "2026-09-03T00:00:00.000Z";

  return {
    id,
    agentDefinitionId: ppcAgentId,
    name,
    input: input as unknown as JsonValue,
    expectedBehavior: expectedBehavior as unknown as JsonValue,
    createdAt: now,
    updatedAt: now,
  };
}
