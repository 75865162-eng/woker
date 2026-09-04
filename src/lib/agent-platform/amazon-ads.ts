import type {
  AgentToolAdapter,
  AgentToolDefinition,
  JsonValue,
  ToolExecutionInput,
  ToolExecutionResult,
} from "./types";

const amazonAdsAdapterId = "amazon-ads-api-adapter";

export interface AmazonAdsPlannedOperation {
  operationId: string;
  operationType: "update_bid" | "add_negative_keyword" | "recommend_campaign_structure";
  target: string;
  payload: JsonValue;
  riskLevel: "HIGH" | "CRITICAL";
}

export interface AmazonAdsExecutionPlan {
  planId: string;
  source: "ppc-agent";
  mode: "dry_run" | "ready_for_execution";
  writeEnabled: boolean;
  operations: AmazonAdsPlannedOperation[];
  warnings: string[];
  generatedAt: string;
}

export const amazonAdsToolDefinitions: AgentToolDefinition[] = [
  {
    toolId: "amazon.ads.recommendation.plan",
    name: "Amazon Ads Recommendation Plan",
    description: "Convert approved PPC recommendations into a dry-run Amazon Ads execution plan.",
    inputSchema: {
      type: "object",
      properties: {
        report: { type: "object" },
        adjustmentDrafts: { type: "array" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        plan: { type: "object" },
      },
    },
    permission: ["amazon.ads.plan"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: amazonAdsAdapterId,
    enabled: true,
  },
  {
    toolId: "amazon.ads.recommendation.apply",
    name: "Amazon Ads Recommendation Apply",
    description: "Apply approved PPC recommendations through Amazon Ads API when write execution is explicitly enabled.",
    inputSchema: {
      type: "object",
      properties: {
        approvalId: { type: "string" },
        plan: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        execution: { type: "object" },
      },
    },
    permission: ["amazon.ads.write.approved"],
    riskLevel: "CRITICAL",
    timeout: 10000,
    retryPolicy: {
      maxAttempts: 1,
      backoffMs: 0,
      retryableErrors: [],
    },
    adapterId: amazonAdsAdapterId,
    enabled: true,
  },
];

export function createAmazonAdsApiAdapter(input: {
  writeEnabled?: boolean;
  clock?: () => Date;
} = {}): AgentToolAdapter {
  const clock = input.clock ?? (() => new Date());
  const writeEnabled = Boolean(input.writeEnabled);

  return {
    adapterId: amazonAdsAdapterId,
    async execute(toolInput: ToolExecutionInput): Promise<ToolExecutionResult> {
      const startedAt = clock().getTime();
      const payload = toRecord(toolInput.input);

      if (toolInput.toolId === "amazon.ads.recommendation.plan") {
        const plan = buildAmazonAdsExecutionPlan({
          report: payload.report,
          adjustmentDrafts: Array.isArray(payload.adjustmentDrafts) ? payload.adjustmentDrafts : [],
          writeEnabled,
          clock,
        });

        return {
          output: toJsonValue({
            plan,
          }),
          latencyMs: Math.max(clock().getTime() - startedAt, 1),
        };
      }

      if (toolInput.toolId === "amazon.ads.recommendation.apply") {
        const plan = toRecord(payload.plan) as unknown as AmazonAdsExecutionPlan;

        if (!toolInput.approval || toolInput.approval.status !== "APPROVED") {
          throw {
            code: "APPROVAL_REQUIRED",
            message: "Amazon Ads apply requires an approved human decision.",
            retryable: false,
          };
        }

        if (!writeEnabled) {
          return {
            output: toJsonValue({
              execution: {
                status: "DRY_RUN_BLOCKED",
                message: "Amazon Ads writes are disabled. Plan was recorded but no live ad changes were sent.",
                plan,
                generatedAt: clock().toISOString(),
              },
            }),
            latencyMs: Math.max(clock().getTime() - startedAt, 1),
          };
        }

        return {
          output: toJsonValue({
            execution: {
              status: "READY_FOR_ADAPTER_IMPLEMENTATION",
              message: "Write execution is enabled, but the real Amazon Ads HTTP client is intentionally not implemented in this phase.",
              plan,
              generatedAt: clock().toISOString(),
            },
          }),
          latencyMs: Math.max(clock().getTime() - startedAt, 1),
        };
      }

      return {
        output: toJsonValue({
          status: "UNHANDLED_TOOL",
          toolId: toolInput.toolId,
          generatedAt: clock().toISOString(),
        }),
        latencyMs: Math.max(clock().getTime() - startedAt, 1),
      };
    },
  };
}

export function buildAmazonAdsExecutionPlan(input: {
  report: unknown;
  adjustmentDrafts: unknown[];
  writeEnabled?: boolean;
  clock?: () => Date;
}): AmazonAdsExecutionPlan {
  const clock = input.clock ?? (() => new Date());
  const report = toRecord(input.report);
  const bidRecommendations = Array.isArray(report.bidRecommendations) ? report.bidRecommendations.map(toRecord) : [];
  const negativeRecommendations = Array.isArray(report.negativeRecommendations) ? report.negativeRecommendations.map(toRecord) : [];
  const campaignRecommendations = Array.isArray(report.campaignRecommendations) ? report.campaignRecommendations.map(toRecord) : [];
  const operations: AmazonAdsPlannedOperation[] = [
    ...bidRecommendations.map((item, index) => ({
      operationId: `ads-op-bid-${index + 1}`,
      operationType: "update_bid" as const,
      target: String(item.rowId ?? item.keyword ?? item.target ?? `bid-${index + 1}`),
      payload: toJsonValue({
        campaignGroupId: item.campaignGroupId,
        keyword: item.keyword,
        target: item.target,
        currentBid: item.currentBid,
        suggestedBid: item.suggestedBid,
        deltaPercent: item.deltaPercent,
        confidence: item.confidence,
      }),
      riskLevel: "HIGH" as const,
    })),
    ...negativeRecommendations.map((item, index) => ({
      operationId: `ads-op-negative-${index + 1}`,
      operationType: "add_negative_keyword" as const,
      target: String(item.term ?? `negative-${index + 1}`),
      payload: toJsonValue({
        term: item.term,
        matchType: item.matchType,
        confidence: item.confidence,
      }),
      riskLevel: "HIGH" as const,
    })),
    ...campaignRecommendations.map((item, index) => ({
      operationId: `ads-op-campaign-${index + 1}`,
      operationType: "recommend_campaign_structure" as const,
      target: String(item.title ?? `campaign-${index + 1}`),
      payload: toJsonValue({
        title: item.title,
        recommendation: item.recommendation,
        confidence: item.confidence,
      }),
      riskLevel: "CRITICAL" as const,
    })),
  ];

  return {
    planId: `amazon-ads-plan-${clock().getTime()}`,
    source: "ppc-agent",
    mode: input.writeEnabled ? "ready_for_execution" : "dry_run",
    writeEnabled: Boolean(input.writeEnabled),
    operations,
    warnings: [
      "Amazon Ads live writes are disabled unless AMAZON_ADS_EXECUTION_ENABLED is explicitly enabled.",
      "Campaign structure recommendations remain planning items until a dedicated Amazon Ads write adapter is implemented.",
      input.adjustmentDrafts.length
        ? `${input.adjustmentDrafts.length} Bulk-compatible adjustment drafts are available for safer export-first execution.`
        : "No Bulk-compatible adjustment drafts were included.",
    ],
    generatedAt: clock().toISOString(),
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, toJsonValue(item)]));
  }
  return null;
}
