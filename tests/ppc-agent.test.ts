import assert from "node:assert/strict";
import test from "node:test";

import { canAgentUseTool } from "@/lib/agent-platform/permissions";
import { createAgentRuntime } from "@/lib/agent-platform/runtime";
import { createApprovalRequest, resolveApproval } from "@/lib/agent-platform/approval";
import { createToolGateway } from "@/lib/agent-platform/tool-gateway";
import { amazonAdsToolDefinitions, createAmazonAdsApiAdapter } from "@/lib/agent-platform/amazon-ads";
import {
  createPpcAgentExecutionExecutor,
  createPpcAnalyticsAdapter,
  ppcAgentDefinition,
  ppcEvaluationCases,
  ppcToolDefinitions,
} from "@/lib/agent-platform/ppc";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CampaignGroup, OverallAdDataRow, PerformanceRow } from "@/lib/types";

const campaignGroups: CampaignGroup[] = [
  {
    id: "campaign-group-1",
    campaignName: "Launch Campaign",
    adGroupName: "Core Keywords",
    lifecycleGroupId: "launch",
    keywordCount: 3,
    lastUpdated: "2026-09-03T00:00:00.000Z",
  },
];

const performanceRows: PerformanceRow[] = [
  {
    id: "row-winner",
    campaignGroupId: "campaign-group-1",
    batchId: "batch-1",
    campaignName: "Launch Campaign",
    adGroupName: "Core Keywords",
    keyword: "desk organizer",
    target: "desk organizer",
    matchType: "exact",
    currentBid: 0.9,
    impressions: 1200,
    clicks: 80,
    orders: 8,
    sales: 240,
    spend: 42,
    topOfSearchShare: 35,
    advertisedProductOrders: 8,
    otherProductOrders: 0,
    viewableImpressions: 0,
    status: "enabled",
  },
  {
    id: "row-waste",
    campaignGroupId: "campaign-group-1",
    batchId: "batch-1",
    campaignName: "Launch Campaign",
    adGroupName: "Core Keywords",
    keyword: "cheap drawer",
    target: "cheap drawer",
    matchType: "broad",
    currentBid: 0.72,
    impressions: 980,
    clicks: 35,
    orders: 0,
    sales: 0,
    spend: 31.5,
    topOfSearchShare: 12,
    advertisedProductOrders: 0,
    otherProductOrders: 0,
    viewableImpressions: 0,
    status: "enabled",
  },
];

const overallRows: OverallAdDataRow[] = [
  {
    id: "overall-1",
    fileId: "file-1",
    campaignGroupId: "campaign-group-1",
    campaignName: "Launch Campaign",
    adGroupName: "Core Keywords",
    keyword: "desk organizer",
    target: "desk organizer",
    matchType: "exact",
    impressions: 1200,
    clicks: 80,
    orders: 8,
    sales: 240,
    spend: 42,
    cpc: 0.52,
    acos: 17.5,
    roas: 5.71,
    matchStatus: "matched",
  },
];

test("ppc agent has a full tool surface and evaluation cases", () => {
  assert.equal(ppcToolDefinitions.length, 8);
  assert.equal(ppcAgentDefinition.tools.length, ppcToolDefinitions.length + 1);
  assert.equal(ppcEvaluationCases.length, 12);
  assert.ok(canAgentUseTool(ppcAgentDefinition, ppcToolDefinitions[0]));
  assert.ok(canAgentUseTool(ppcAgentDefinition, amazonAdsToolDefinitions[0]));
  assert.equal(canAgentUseTool(ppcAgentDefinition, amazonAdsToolDefinitions[1]), false);
});

test("ppc agent runtime creates diagnosis, recommendations, and drafts", async () => {
  const clock = () => new Date("2026-09-03T00:00:00.000Z");
  const runtime = createAgentRuntime({
    definitions: [ppcAgentDefinition],
    tools: [...ppcToolDefinitions, ...amazonAdsToolDefinitions],
    adapters: [createPpcAnalyticsAdapter(clock), createAmazonAdsApiAdapter({ clock })],
    clock,
  });

  const result = await runtime.run({
    agentId: ppcAgentDefinition.id,
    context: {
      company: { organizationId: "org-ppc" },
      workspace: { workspaceId: "default", accountId: "", marketplace: "US" },
      user: { id: "user-ppc", email: "ppc@example.com" },
      marketplace: "US",
      currentData: {
        goal: "诊断 PPC 并给出建议",
        marketplace: "US",
        campaignGroups,
        performanceRows,
        overallAdDataRows: overallRows,
      },
    },
    input: {
      naturalLanguageGoal: "诊断 PPC 并给出建议",
      marketplace: "US",
      targetAcos: 30,
    },
    requestedByUserId: "user-ppc",
    workspaceId: "default",
    accountId: "",
    marketplace: "US",
    executor: createPpcAgentExecutionExecutor({
      request: {
        naturalLanguageGoal: "诊断 PPC 并给出建议",
        marketplace: "US",
        campaignGroups,
        performanceRows,
        overallAdDataRows: overallRows,
        targetAcos: 30,
        sellerSpriteKeywords: {
          primaryKeywords: ["desk organizer", "desktop organizer"],
        },
      },
      requestedByUserId: "user-ppc",
      clock,
    }),
  });

  const output = result.execution.output as Record<string, unknown>;
  const report = output.report as Record<string, unknown>;
  const drafts = output.adjustmentDrafts as unknown[];

  assert.equal(result.execution.status, "COMPLETED");
  assert.equal(result.toolCalls.length, 8);
  assert.ok(result.memoryItems.length >= 1);
  assert.ok(result.traces.some((trace) => trace.type === "recommendation"));
  assert.ok(Array.isArray(report.bidRecommendations));
  assert.ok(Array.isArray(report.negativeRecommendations));
  assert.ok(drafts.length >= 1);
});

test("ppc agent cannot call a tool outside its permission matrix", () => {
  assert.equal(
    canAgentUseTool(
      ppcAgentDefinition,
      {
        ...ppcToolDefinitions[0],
        toolId: "amazon.ads.apply",
        permission: ["amazon.ads.write.direct"],
        riskLevel: "CRITICAL",
      },
    ),
    false,
  );
});

test("amazon ads adapter plans safely and blocks apply without approval", async () => {
  const clock = () => new Date("2026-09-03T00:00:00.000Z");
  const gateway = createToolGateway({
    tools: amazonAdsToolDefinitions,
    adapters: [createAmazonAdsApiAdapter({ clock })],
    clock,
  });
  const planResult = await gateway.invoke({
    agent: ppcAgentDefinition,
    executionId: "execution-ads-plan",
    context: {},
    toolId: "amazon.ads.recommendation.plan",
    input: {
      report: {
        bidRecommendations: [
          {
            rowId: "row-winner",
            campaignGroupId: "campaign-group-1",
            keyword: "desk organizer",
            target: "desk organizer",
            currentBid: 0.9,
            suggestedBid: 0.97,
            deltaPercent: 7.8,
            confidence: 0.82,
          },
        ],
        negativeRecommendations: [
          {
            term: "cheap drawer",
            matchType: "broad",
            confidence: 0.86,
          },
        ],
        campaignRecommendations: [
          {
            title: "Protect winner terms",
            recommendation: "Split exact winners into a dedicated campaign.",
            confidence: 0.86,
          },
        ],
      },
      adjustmentDrafts: [],
    },
  });

  assert.equal(planResult.status, "SUCCEEDED");
  assert.equal(((planResult.output as Record<string, unknown>).plan as Record<string, unknown>).mode, "dry_run");

  const applyDenied = await gateway.invoke({
    agent: {
      ...ppcAgentDefinition,
      tools: [...ppcAgentDefinition.tools, "amazon.ads.recommendation.apply"],
      permissions: [...ppcAgentDefinition.permissions, "amazon.ads.write.approved"],
    },
    executionId: "execution-ads-apply",
    context: {},
    toolId: "amazon.ads.recommendation.apply",
    input: {
      plan: (planResult.output as Record<string, unknown>).plan,
    },
  });

  assert.equal(applyDenied.status, "APPROVAL_REQUIRED");

  const approval = resolveApproval({
    approval: createApprovalRequest({
      executionId: "execution-ads-apply",
      riskLevel: "CRITICAL",
      recommendation: {
        summary: "Approve Amazon Ads apply",
      },
      action: {
        type: "amazon.ads.apply",
      },
    }),
    decision: "APPROVED",
  });
  const dryRunApply = await gateway.invoke({
    agent: {
      ...ppcAgentDefinition,
      tools: [...ppcAgentDefinition.tools, "amazon.ads.recommendation.apply"],
      permissions: [...ppcAgentDefinition.permissions, "amazon.ads.write.approved"],
    },
    executionId: "execution-ads-apply",
    context: {},
    toolId: "amazon.ads.recommendation.apply",
    input: {
      plan: (planResult.output as Record<string, unknown>).plan,
    },
    approval,
  });

  assert.equal(dryRunApply.status, "SUCCEEDED");
  assert.equal((((dryRunApply.output as Record<string, unknown>).execution as Record<string, unknown>).status), "DRY_RUN_BLOCKED");
});

test("approved ppc drafts can be queued into the workspace pending draft queue", () => {
  useWorkspaceStore.setState({
    pendingAdjustmentDrafts: [
      {
        id: "old-draft",
        campaignGroupId: "campaign-group-1",
        rowId: "row-old",
        field: "bid",
        headerName: "竞价",
        oldValue: 0.4,
        newValue: 0.35,
        keyword: "old keyword",
        target: "old keyword",
        currentBid: 0.4,
        suggestedBid: 0.35,
        deltaPercent: -12.5,
        reason: "old",
        matchedRule: "Old Rule",
        selected: false,
      },
    ],
  });

  const result = useWorkspaceStore.getState().queueApprovedAgentDrafts([
    {
      id: "ppc-agent-draft",
      campaignGroupId: "campaign-group-1",
      rowId: "row-winner",
      field: "bid",
      headerName: "竞价",
      oldValue: 0.9,
      newValue: 0.97,
      keyword: "desk organizer",
      target: "desk organizer",
      currentBid: 0.9,
      suggestedBid: 0.97,
      deltaPercent: 7.8,
      reason: "PPC Agent scale winner",
      matchedRule: "PPC Agent",
      selected: false,
    },
  ]);

  const pendingDrafts = useWorkspaceStore.getState().pendingAdjustmentDrafts;

  assert.deepEqual(result, { draftCount: 1, campaignGroupCount: 1 });
  assert.equal(pendingDrafts.length, 1);
  assert.equal(pendingDrafts[0]?.id, "ppc-agent-draft");
  assert.equal(pendingDrafts[0]?.selected, true);
});
