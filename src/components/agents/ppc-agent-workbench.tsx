"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Clock3, FileText, RefreshCw, ShieldAlert, SlidersHorizontal, Target, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  AgentApproval,
  AgentCenterItem,
  AgentExecutionDetail,
  AgentExecutionSummary,
  AgentMemoryEntry,
  AgentToolCall,
  AgentToolDefinition,
  AgentTraceEvent,
} from "@/lib/agent-platform";
import type { PpcAnalysisReport, PpcExecutionOutput, PpcExecutionRequest } from "@/lib/agent-platform/ppc";
import { initializeWorkspaceStorePersistence, useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { AdjustmentDraft } from "@/lib/types";

type PpcAgentResponse = {
  agent: AgentCenterItem;
  tools: AgentToolDefinition[];
  executions: AgentExecutionSummary[];
  latestExecution: AgentExecutionDetail | null;
  memoryItems: AgentMemoryEntry[];
};

type PpcExecutionResponse = {
  execution: Omit<AgentExecutionDetail, "approvals" | "toolCalls" | "traces" | "events">;
  executions: AgentExecutionSummary[];
  approvals: AgentApproval[];
  toolCalls: AgentToolCall[];
  traces: AgentTraceEvent[];
  events: unknown[];
};

type PpcActionResponse = {
  execution: AgentExecutionDetail;
  approval: AgentApproval;
  task: {
    id: string;
    status: string;
  };
};

function formatDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function parsePpcOutput(output: unknown): PpcExecutionOutput | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  const report = record.report as PpcAnalysisReport | undefined;

  if (report && typeof report === "object") {
    return {
      report,
      evidence: (record.evidence as PpcExecutionOutput["evidence"]) ?? report.evidence ?? [],
      adjustmentDrafts: (record.adjustmentDrafts as AdjustmentDraft[]) ?? [],
      amazonAdsPlan: record.amazonAdsPlan as PpcExecutionOutput["amazonAdsPlan"],
      memoryItems: [],
    };
  }

  const reportSnapshot = record.reportSnapshot as PpcAnalysisReport | undefined;
  if (reportSnapshot && typeof reportSnapshot === "object") {
    return {
      report: reportSnapshot,
      evidence: reportSnapshot.evidence ?? [],
      adjustmentDrafts: (record.adjustmentDrafts as AdjustmentDraft[]) ?? [],
      amazonAdsPlan: record.amazonAdsPlan as PpcExecutionOutput["amazonAdsPlan"],
      memoryItems: [],
    };
  }

  return null;
}

function getCurrentApproval(execution?: AgentExecutionDetail | null, fallback?: AgentApproval | null) {
  const requested = execution?.approvals?.find((approval) => approval.status === "REQUESTED");
  return requested ?? execution?.approvals?.[0] ?? fallback ?? null;
}

function badgeTone(score: number) {
  if (score >= 80) return "green";
  if (score >= 60) return "blue";
  if (score >= 45) return "amber";
  return "red";
}

function severityTone(severity: string) {
  if (severity === "high") return "red";
  if (severity === "medium") return "amber";
  return "gray";
}

export function PpcAgentWorkbench() {
  const [data, setData] = useState<PpcAgentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [running, setRunning] = useState(false);
  const [actionBusy, setActionBusy] = useState<"bulk.export.prepare" | "amazon.ads.apply" | "">("");
  const [decisionBusy, setDecisionBusy] = useState<"APPROVED" | "REJECTED" | "">("");
  const [pendingApproval, setPendingApproval] = useState<AgentApproval | null>(null);
  const [goal, setGoal] = useState("诊断当前 PPC 工作区，输出控损、扩量、竞价、否定词和广告结构建议");
  const [marketplace, setMarketplace] = useState("US");
  const [targetAcos, setTargetAcos] = useState("30");
  const [targetRoas, setTargetRoas] = useState("3");
  const [targetMargin, setTargetMargin] = useState("25");
  const [sellerSpriteKeywords, setSellerSpriteKeywords] = useState("core keyword\nlong tail keyword\ncompetitor keyword");
  const [productContext, setProductContext] = useState("当前 SKU 的商品背景、定位、生命周期、价格和利润假设。");
  const [handoffMessage, setHandoffMessage] = useState("");
  const {
    campaignGroups,
    workspaceUnits,
    performanceRows,
    overallAdDataRows,
    pendingAdjustmentDrafts,
    activeCampaignGroupId,
    activeWorkspaceUnitId,
    workspaceMode,
    overallAdDataMatchSummary,
    parseStatus,
    uploadedFileName,
    queueApprovedAgentDrafts,
  } = useWorkspaceStore();

  useEffect(() => {
    initializeWorkspaceStorePersistence();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    fetch("/api/agents/ppc")
      .then(async (response) => {
        const payload = (await response.json()) as PpcAgentResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || "加载 PPC Agent 失败。");
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载 PPC Agent 失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const currentExecution = data?.latestExecution ?? null;
  const ppcExecution = useMemo(() => parsePpcOutput(currentExecution?.output), [currentExecution?.output]);
  const report = ppcExecution?.report ?? null;
  const adjustmentDrafts = ppcExecution?.adjustmentDrafts ?? [];
  const amazonAdsPlan = ppcExecution?.amazonAdsPlan && typeof ppcExecution.amazonAdsPlan === "object" && !Array.isArray(ppcExecution.amazonAdsPlan)
    ? ppcExecution.amazonAdsPlan as Record<string, unknown>
    : null;
  const currentApproval = getCurrentApproval(currentExecution, pendingApproval);
  const toolCalls = currentExecution?.toolCalls ?? [];
  const traces = currentExecution?.traces ?? [];
  const memoryItems = data?.memoryItems ?? [];

  const scopedCampaignGroups = useMemo(() => {
    if (workspaceMode === "workspace-unit" && activeWorkspaceUnitId) {
      const unit = workspaceUnits.find((item) => item.id === activeWorkspaceUnitId);
      return unit ? campaignGroups.filter((group) => unit.campaignGroupIds.includes(group.id)) : campaignGroups.slice(0, 6);
    }

    if (activeCampaignGroupId) {
      const active = campaignGroups.find((group) => group.id === activeCampaignGroupId);
      return active ? [active] : campaignGroups.slice(0, 6);
    }

    return campaignGroups.slice(0, 6);
  }, [activeCampaignGroupId, activeWorkspaceUnitId, campaignGroups, workspaceMode, workspaceUnits]);

  const scopedGroupIds = useMemo(() => new Set(scopedCampaignGroups.map((group) => group.id)), [scopedCampaignGroups]);
  const scopedPerformanceRows = useMemo(
    () => performanceRows.filter((row) => !scopedGroupIds.size || scopedGroupIds.has(row.campaignGroupId)).slice(0, 120),
    [performanceRows, scopedGroupIds],
  );
  const scopedOverallRows = useMemo(
    () => overallAdDataRows.filter((row) => !row.campaignGroupId || !scopedGroupIds.size || scopedGroupIds.has(row.campaignGroupId)).slice(0, 160),
    [overallAdDataRows, scopedGroupIds],
  );

  async function refresh() {
    setRefreshToken((current) => current + 1);
  }

  function parseKeywords() {
    const values = sellerSpriteKeywords
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);

    return {
      primaryKeywords: values.slice(0, 4),
      secondaryKeywords: values.slice(4, 8),
      longTailKeywords: values.slice(8, 12),
    };
  }

  async function runDiagnosis() {
    setRunning(true);
    setError("");
    setHandoffMessage("");
    setPendingApproval(null);

    try {
      const requestBody: PpcExecutionRequest = {
        naturalLanguageGoal: goal,
        marketplace,
        campaignGroupId: activeCampaignGroupId || undefined,
        workspaceUnitId: activeWorkspaceUnitId,
        workspaceMode,
        campaignGroups: scopedCampaignGroups,
        performanceRows: scopedPerformanceRows,
        overallAdDataRows: scopedOverallRows,
        sellerSpriteKeywords: parseKeywords(),
        productContext: {
          summary: productContext,
          uploadedFileName: uploadedFileName ?? null,
        },
        targetAcos: Number(targetAcos) || undefined,
        targetRoas: Number(targetRoas) || undefined,
        targetMargin: Number(targetMargin) || undefined,
        context: {
          currentData: {
            goal,
            marketplace,
            campaignGroups: scopedCampaignGroups,
            performanceRows: scopedPerformanceRows,
            overallAdDataRows: scopedOverallRows,
            productContext,
            sellerSpriteKeywords: parseKeywords(),
            targetAcos: Number(targetAcos) || undefined,
            targetRoas: Number(targetRoas) || undefined,
            targetMargin: Number(targetMargin) || undefined,
            workspaceMode,
            activeCampaignGroupId,
            activeWorkspaceUnitId,
            pendingAdjustmentDrafts,
          },
        },
      };
      const response = await fetch("/api/agents/ppc/executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const payload = (await response.json()) as PpcExecutionResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "运行 PPC Agent 失败。");

      const detailedExecution: AgentExecutionDetail = {
        ...payload.execution,
        approvals: payload.approvals,
        toolCalls: payload.toolCalls,
        traces: payload.traces,
        events: payload.events as AgentExecutionDetail["events"],
      };

      setData((current) =>
        current
          ? {
              ...current,
              latestExecution: detailedExecution,
              executions: [
                {
                  id: detailedExecution.id,
                  agentDefinitionId: detailedExecution.agentDefinitionId,
                  agentName: current.agent.name,
                  status: detailedExecution.status,
                  createdAt: detailedExecution.createdAt,
                  finishedAt: detailedExecution.finishedAt,
                  tokenUsage: detailedExecution.tokenUsage,
                  toolCallCount: detailedExecution.toolCallCount,
                  approvalStatus: detailedExecution.approvalStatus,
                },
                ...current.executions.filter((item) => item.id !== detailedExecution.id),
              ],
            }
          : current,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "运行 PPC Agent 失败。");
    } finally {
      setRunning(false);
    }
  }

  async function requestActionApproval(actionTarget: "bulk.export.prepare" | "amazon.ads.apply") {
    if (!report) return;

    setActionBusy(actionTarget);
    setError("");
    setHandoffMessage("");

    try {
      const response = await fetch("/api/agents/ppc/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionTarget,
          report,
          adjustmentDrafts,
          marketplace,
          context: {
            currentData: {
              report,
              adjustmentDrafts,
            },
          },
        }),
      });
      const payload = (await response.json()) as PpcActionResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "请求 PPC 审批失败。");

      setPendingApproval(payload.approval);
      setData((current) =>
        current
          ? {
              ...current,
              latestExecution: payload.execution,
              executions: [
                {
                  id: payload.execution.id,
                  agentDefinitionId: payload.execution.agentDefinitionId,
                  agentName: current.agent.name,
                  status: payload.execution.status,
                  createdAt: payload.execution.createdAt,
                  finishedAt: payload.execution.finishedAt,
                  tokenUsage: payload.execution.tokenUsage,
                  toolCallCount: payload.execution.toolCallCount,
                  approvalStatus: payload.execution.approvalStatus,
                },
                ...current.executions.filter((item) => item.id !== payload.execution.id),
              ],
            }
          : current,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求 PPC 审批失败。");
    } finally {
      setActionBusy("");
    }
  }

  async function resolveApproval(decision: "APPROVED" | "REJECTED") {
    if (!currentApproval) return;

    setDecisionBusy(decision);
    setError("");

    try {
      const response = await fetch(`/api/agents/approvals/${currentApproval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          reason: decision === "APPROVED" ? "PPC recommendation bundle approved." : "PPC recommendation bundle rejected.",
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "处理审批失败。");

      if (decision === "APPROVED" && currentApproval.action.type === "bulk.export.prepare") {
        const result = queueApprovedAgentDrafts(adjustmentDrafts);
        setHandoffMessage(`已把 ${result.draftCount} 条 PPC 草稿加入待处理队列，覆盖 ${result.campaignGroupCount} 个广告组。`);
      }

      setPendingApproval(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "处理审批失败。");
    } finally {
      setDecisionBusy("");
    }
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>PPC 诊断</CardTitle>
              <p className="mt-1 text-xs font-medium text-muted">读取当前 PPC 工作区快照，生成可审计、可审批的建议包。</p>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={refresh} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {error ? <div className="rounded-md border border-danger/30 bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{error}</div> : null}
            {handoffMessage ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">
                <span>{handoffMessage}</span>
                <Link href="/workspace" prefetch={false} className="text-brand underline">
                  去 PPC 工作台导出
                </Link>
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricTile icon={<Target className="h-4 w-4 text-brand" />} label="广告组" value={scopedCampaignGroups.length} />
              <MetricTile icon={<FileText className="h-4 w-4 text-brand" />} label="PPC 行" value={scopedPerformanceRows.length} />
              <MetricTile icon={<SlidersHorizontal className="h-4 w-4 text-brand" />} label="总表行" value={scopedOverallRows.length} />
              <MetricTile icon={<Clock3 className="h-4 w-4 text-brand" />} label="待处理草稿" value={pendingAdjustmentDrafts.length} />
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              <label className="block space-y-1 lg:col-span-3">
                <span className="text-xs font-semibold text-muted">研究目标</span>
                <textarea
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  className="min-h-20 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-brand"
                />
              </label>
              <Input label="站点" value={marketplace} onChange={setMarketplace} />
              <Input label="目标 ACOS %" value={targetAcos} onChange={setTargetAcos} />
              <Input label="目标 ROAS" value={targetRoas} onChange={setTargetRoas} />
              <Input label="目标利润率 %" value={targetMargin} onChange={setTargetMargin} />
              <label className="block space-y-1 lg:col-span-2">
                <span className="text-xs font-semibold text-muted">SellerSprite 关键词</span>
                <textarea
                  value={sellerSpriteKeywords}
                  onChange={(event) => setSellerSpriteKeywords(event.target.value)}
                  className="min-h-20 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-brand"
                />
              </label>
              <label className="block space-y-1 lg:col-span-3">
                <span className="text-xs font-semibold text-muted">商品信息</span>
                <textarea
                  value={productContext}
                  onChange={(event) => setProductContext(event.target.value)}
                  className="min-h-20 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-brand"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={runDiagnosis} disabled={running || scopedPerformanceRows.length === 0}>
                <SparkIcon />
                {running ? "运行中..." : "运行 PPC Agent"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => requestActionApproval("bulk.export.prepare")}
                disabled={!report || actionBusy !== ""}
              >
                <ShieldAlert className="h-4 w-4" />
                {actionBusy === "bulk.export.prepare" ? "请求中..." : "审批批量交接"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => requestActionApproval("amazon.ads.apply")}
                disabled={!report || actionBusy !== ""}
              >
                <ShieldAlert className="h-4 w-4" />
                {actionBusy === "amazon.ads.apply" ? "请求中..." : "审批 Amazon API"}
              </Button>
            </div>
            {parseStatus !== "completed" && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                当前 PPC 工作区还没有完成 Bulk 导入，建议先到 PPC 优化工作台导入数据。
              </div>
            )}
            <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs font-semibold text-muted">
              Overall 匹配：{overallAdDataMatchSummary.matchedRows} 已匹配 / {overallAdDataMatchSummary.unmatchedRows} 未匹配 / {overallAdDataMatchSummary.ambiguousRows} 有歧义
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>审批</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {currentApproval ? (
              <>
                <div className="rounded-md border border-border bg-surface-muted px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={currentApproval.status === "REQUESTED" ? "amber" : currentApproval.status === "APPROVED" ? "green" : "red"}>
                      {currentApproval.status}
                    </Badge>
                    <Badge tone={currentApproval.riskLevel === "CRITICAL" ? "red" : "amber"}>{currentApproval.riskLevel}</Badge>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-foreground">{currentApproval.recommendation.summary}</p>
                  <p className="mt-1 text-xs font-medium text-muted">{formatDate(currentApproval.requestedAt)}</p>
                </div>
                {amazonAdsPlan ? (
                  <div className="rounded-md border border-border bg-white px-3 py-2 text-xs font-semibold text-muted">
                    <div className="font-black text-foreground">Amazon Ads 方案</div>
                    <div className="mt-1">模式：{String(amazonAdsPlan.mode ?? "-")}</div>
                    <div>操作数：{Array.isArray(amazonAdsPlan.operations) ? amazonAdsPlan.operations.length : 0}</div>
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" onClick={() => resolveApproval("APPROVED")} disabled={currentApproval.status !== "REQUESTED" || decisionBusy !== ""}>
                    <CheckCircle2 className="h-4 w-4" />
                    {decisionBusy === "APPROVED" ? "审批中..." : "通过"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => resolveApproval("REJECTED")} disabled={currentApproval.status !== "REQUESTED" || decisionBusy !== ""}>
                    <TriangleAlert className="h-4 w-4" />
                    {decisionBusy === "REJECTED" ? "驳回中..." : "驳回"}
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm font-semibold text-muted">
                生成报告后，可提交 Bulk 或 Amazon API 审批。
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {report ? (
        <section className="grid gap-3 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>建议报告</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-bold text-foreground">{report.summary}</p>
                <p className="mt-1 text-sm text-muted">{report.recommendation}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {report.opportunities.map((item) => (
                  <div key={item.opportunityId} className="rounded-md border border-border bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-black text-foreground">{item.title}</p>
                        <p className="mt-1 text-xs font-semibold text-muted">{item.type}</p>
                      </div>
                      <Badge tone={badgeTone(item.score)}>{item.score}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted">{item.rationale}</p>
                  </div>
                ))}
              </div>
              <SectionTitle title="诊断" />
              <div className="space-y-2">
                {report.diagnosis.map((item) => (
                  <div key={`${item.issue}-${item.impact}`} className="rounded-md border border-border bg-surface-muted p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={severityTone(item.severity)}>{item.severity}</Badge>
                      <span className="text-sm font-black text-foreground">{item.issue}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted">{item.impact}</p>
                  </div>
                ))}
              </div>
              <SectionTitle title="竞价建议" />
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-surface-muted text-xs font-bold text-muted">
                    <tr>
                      <th className="px-3 py-2 text-left">关键词</th>
                      <th className="px-3 py-2 text-right">当前</th>
                      <th className="px-3 py-2 text-right">建议</th>
                      <th className="px-3 py-2 text-right">变化</th>
                      <th className="px-3 py-2 text-left">原因</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-white">
                    {report.bidRecommendations.map((item) => (
                      <tr key={item.rowId}>
                        <td className="px-3 py-2 font-semibold text-foreground">{item.keyword || item.target}</td>
                        <td className="px-3 py-2 text-right font-semibold text-muted">${item.currentBid.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-black text-brand">${item.suggestedBid.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-muted">{item.deltaPercent}%</td>
                        <td className="px-3 py-2 text-muted">{item.recommendation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <Card>
              <CardHeader>
            <CardTitle>否定词建议</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {report.negativeRecommendations.map((item) => (
                  <div key={`${item.term}-${item.matchType}`} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-black text-foreground">{item.term}</span>
                      <Badge tone="amber">{item.matchType}</Badge>
                    </div>
                    <p className="mt-1 text-xs font-medium text-muted">{item.recommendation}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
            <CardTitle>广告系列建议</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {report.campaignRecommendations.map((item) => (
                  <div key={item.title} className="rounded-md border border-border p-3">
                    <p className="text-sm font-black text-foreground">{item.title}</p>
                    <p className="mt-1 text-xs font-medium text-muted">{item.recommendation}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>
      ) : null}

      <section className="grid gap-3 xl:grid-cols-3">
        <TracePanel title="工具调用" items={toolCalls.map((item) => `${item.toolId} · ${item.status} · ${item.latencyMs ?? 0}ms`)} />
        <TracePanel title="执行时间线" items={traces.map((item) => `${item.sequence}. ${item.type} · ${item.message ?? ""}`)} />
        <TracePanel title="记忆" items={memoryItems.map((item) => `${formatDate(item.createdAt)} · ${item.summary}`)} />
      </section>
    </div>
  );
}

function MetricTile({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-surface-muted px-3 py-2">
      <div className="flex items-center gap-2 text-xs font-bold uppercase text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-black text-foreground">{value}</div>
    </div>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-border px-3 text-sm font-semibold outline-none focus:border-brand"
      />
    </label>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h3 className="text-sm font-black text-foreground">{title}</h3>;
}

function TracePanel({ title, items }: { title: string; items: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <div className="space-y-2">
            {items.slice(0, 12).map((item, index) => (
              <div key={`${title}-${index}`} className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs font-semibold text-muted">
                {item}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm font-semibold text-muted">
            暂无数据。
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SparkIcon() {
  return <RefreshCw className="h-4 w-4" />;
}
