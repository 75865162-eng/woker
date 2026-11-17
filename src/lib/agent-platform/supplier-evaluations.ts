import type { JsonValue } from "./types";
import type { SupplierExecutionRequest } from "./supplier";

export const supplierEvaluationCases = [
  evaluationCase("supplier-case-01", "Normal handoff", {
    naturalLanguageGoal: "把 PRD 转成供应商推荐和 RFQ 草稿",
    marketplace: "US",
  }, {
    shouldLoadProductContext: true,
    shouldRecommendSuppliers: true,
    shouldDraftRFQ: true,
  }),
  evaluationCase("supplier-case-02", "Missing PRD", {
    naturalLanguageGoal: "我还没有 PRD",
    marketplace: "US",
  }, {
    shouldFallbackGracefully: true,
  }),
  evaluationCase("supplier-case-03", "Fuzzy brief", {
    naturalLanguageGoal: "帮我找靠谱工厂",
    marketplace: "US",
  }, {
    shouldInferSourcingIntent: true,
  }),
  evaluationCase("supplier-case-04", "Cost pressure", {
    naturalLanguageGoal: "尽量压低成本",
    marketplace: "US",
  }, {
    shouldEmphasizeCostTradeoff: true,
  }),
  evaluationCase("supplier-case-05", "Lead time pressure", {
    naturalLanguageGoal: "交期越短越好",
    marketplace: "US",
  }, {
    shouldEmphasizeLeadTime: true,
  }),
  evaluationCase("supplier-case-06", "Category specific", {
    naturalLanguageGoal: "做宠物用品供应商分析",
    marketplace: "US",
    category: "Pet Supplies",
  }, {
    shouldRespectCategoryScope: true,
  }),
  evaluationCase("supplier-case-07", "Quotation comparison", {
    naturalLanguageGoal: "比较报价差异",
    marketplace: "US",
  }, {
    shouldCompareQuotations: true,
  }),
  evaluationCase("supplier-case-08", "Low confidence", {
    naturalLanguageGoal: "信息不多先给推荐",
    marketplace: "US",
  }, {
    shouldLowerConfidence: true,
  }),
  evaluationCase("supplier-case-09", "Project approval", {
    naturalLanguageGoal: "生成供应项目草案",
    marketplace: "US",
  }, {
    shouldCreateProjectDraft: true,
    shouldWaitForHumanReview: true,
  }),
  evaluationCase("supplier-case-10", "Non-US marketplace", {
    naturalLanguageGoal: "做英国站供应商分析",
    marketplace: "UK",
  }, {
    shouldRespectMarketplaceScope: true,
  }),
];

function evaluationCase(
  id: string,
  name: string,
  input: SupplierExecutionRequest,
  expectedBehavior: Record<string, JsonValue>,
) {
  const now = "2026-09-02T00:00:00.000Z";

  return {
    id,
    name,
    input: input as unknown as JsonValue,
    expectedBehavior: expectedBehavior as unknown as JsonValue,
    createdAt: now,
    updatedAt: now,
  };
}
