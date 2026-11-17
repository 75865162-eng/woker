import type { JsonValue } from "./types";
import type { ListingExecutionRequest } from "./listing";

export const listingEvaluationCases = [
  evaluationCase("listing-case-01", "Normal handoff", {
    naturalLanguageGoal: "把产品计划转成 Listing Draft",
    marketplace: "US",
  }, {
    shouldLoadProductContext: true,
    shouldBuildKeywordMap: true,
    shouldDraftTitle: true,
    shouldDraftBullets: true,
  }),
  evaluationCase("listing-case-02", "Missing product report", {
    naturalLanguageGoal: "帮我写 listing",
    marketplace: "US",
  }, {
    shouldFallbackGracefully: true,
  }),
  evaluationCase("listing-case-03", "Keyword heavy", {
    naturalLanguageGoal: "围绕关键词优化 listing",
    marketplace: "US",
  }, {
    shouldPrioritizeKeywords: true,
  }),
  evaluationCase("listing-case-04", "Competitor heavy", {
    naturalLanguageGoal: "根据竞品重写 listing",
    marketplace: "US",
  }, {
    shouldUseCompetitorGaps: true,
  }),
  evaluationCase("listing-case-05", "Title focus", {
    naturalLanguageGoal: "先做标题",
    marketplace: "US",
  }, {
    shouldDraftTitle: true,
  }),
  evaluationCase("listing-case-06", "Bullet focus", {
    naturalLanguageGoal: "优化 bullets",
    marketplace: "US",
  }, {
    shouldDraftBullets: true,
  }),
  evaluationCase("listing-case-07", "Description focus", {
    naturalLanguageGoal: "重写 description",
    marketplace: "US",
  }, {
    shouldDraftDescription: true,
  }),
  evaluationCase("listing-case-08", "A+ focus", {
    naturalLanguageGoal: "生成 A+ brief",
    marketplace: "US",
  }, {
    shouldDraftAplus: true,
  }),
  evaluationCase("listing-case-09", "Low confidence", {
    naturalLanguageGoal: "信息不多先给 draft",
    marketplace: "US",
  }, {
    shouldLowerConfidence: true,
  }),
  evaluationCase("listing-case-10", "Human approval", {
    naturalLanguageGoal: "生成 listing draft 供审批",
    marketplace: "US",
  }, {
    shouldWaitForHumanReview: true,
  }),
];

function evaluationCase(
  id: string,
  name: string,
  input: ListingExecutionRequest,
  expectedBehavior: Record<string, JsonValue>,
) {
  const now = "2026-09-03T00:00:00.000Z";

  return {
    id,
    name,
    input: input as unknown as JsonValue,
    expectedBehavior: expectedBehavior as unknown as JsonValue,
    createdAt: now,
    updatedAt: now,
  };
}
