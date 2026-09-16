"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileText, RefreshCw, Sparkles, SquareKanban, TriangleAlert } from "lucide-react";
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
import { listingHandoffStorageKey, type ListingAnalysisReport, type ListingExecutionOutput, type ListingExecutionRequest } from "@/lib/agent-platform/listing";
import type { ProductDevelopmentReport } from "@/lib/agent-platform/product";
import type { MarketResearchReport } from "@/lib/agent-platform/market";
import type { ProductOpportunity } from "@/lib/agent-platform/market";

type ListingAgentResponse = {
  agent: AgentCenterItem;
  tools: AgentToolDefinition[];
  executions: AgentExecutionSummary[];
  latestExecution: AgentExecutionDetail | null;
  memoryItems: AgentMemoryEntry[];
};

type ListingExecutionResponse = {
  execution: Omit<AgentExecutionDetail, "approvals" | "toolCalls" | "traces" | "events">;
  executions: AgentExecutionSummary[];
  approvals: AgentApproval[];
  toolCalls: AgentToolCall[];
  traces: AgentTraceEvent[];
  events: unknown[];
};

type ListingProjectResponse = {
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

function parseListingOutput(output: unknown): ListingExecutionOutput | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  const report = record.report as ListingAnalysisReport | undefined;
  if (report && typeof report === "object") {
    return {
      report,
      evidence: (record.evidence as ListingExecutionOutput["evidence"]) ?? report.evidence ?? [],
      memoryItems: [],
    };
  }
  return null;
}

function getCurrentApproval(execution?: AgentExecutionDetail | null, fallback?: AgentApproval | null) {
  const requested = execution?.approvals?.find((approval) => approval.status === "REQUESTED");
  return requested ?? execution?.approvals?.[0] ?? fallback ?? null;
}

function asProductReport(value: unknown): ProductDevelopmentReport | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ProductDevelopmentReport) : undefined;
}

function asMarketReport(value: unknown): MarketResearchReport | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as MarketResearchReport) : undefined;
}

function asOpportunity(value: unknown): ProductOpportunity | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ProductOpportunity) : undefined;
}

export function ListingAgentWorkbench() {
  const [data, setData] = useState<ListingAgentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [running, setRunning] = useState(false);
  const [projecting, setProjecting] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState<"APPROVED" | "REJECTED" | "">("");
  const [goal, setGoal] = useState("把产品 Agent 的计划转成刊登草稿");
  const [marketplace, setMarketplace] = useState("US");
  const [category, setCategory] = useState("");
  const [keywordsInput, setKeywordsInput] = useState("primary: product title\nsecondary: conversion focused\nlong-tail: listing optimization");
  const [competitorsInput, setCompetitorsInput] = useState("竞品 A：通用标题\n竞品 B：卖点较弱");
  const [selectedHandoff, setSelectedHandoff] = useState<Record<string, unknown> | null>(null);
  const [pendingApproval, setPendingApproval] = useState<AgentApproval | null>(null);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(listingHandoffStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      setSelectedHandoff(parsed);
      if (typeof parsed.goal === "string") setGoal(parsed.goal);
      if (typeof parsed.marketplace === "string") setMarketplace(parsed.marketplace);
      if (typeof parsed.category === "string") setCategory(parsed.category);
      window.sessionStorage.removeItem(listingHandoffStorageKey);
    } catch {
      window.sessionStorage.removeItem(listingHandoffStorageKey);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    fetch("/api/agents/listing")
      .then(async (response) => {
        const payload = (await response.json()) as ListingAgentResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || "加载刊登 Agent 失败。");
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载刊登 Agent 失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const currentExecution = data?.latestExecution ?? null;
  const listingExecution = useMemo(() => parseListingOutput(currentExecution?.output), [currentExecution?.output]);
  const report = listingExecution?.report ?? null;
  const currentApproval = getCurrentApproval(currentExecution, pendingApproval);
  const toolCalls = currentExecution?.toolCalls ?? [];
  const traces = currentExecution?.traces ?? [];
  const memoryItems = data?.memoryItems ?? [];

  async function refresh() {
    setRefreshToken((current) => current + 1);
  }

  function buildKeywordPayload() {
    const primary = keywordsInput
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const competitorLines = competitorsInput
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean);

    return {
      primaryKeywords: primary.slice(0, 4),
      secondaryKeywords: primary.slice(4, 8),
      longTailKeywords: primary.slice(8, 12),
      backendSearchTerms: primary.slice(0, 6),
      competitorGaps: competitorLines.slice(0, 4),
    };
  }

  function buildCompetitorPayload() {
    return competitorsInput
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item, index) => ({
        name: item.split(":")[0]?.trim() || `竞品 ${index + 1}`,
        weakness: item.split(":")[1]?.trim() || "通用定位",
        opportunity: "更强的关键词和卖点叙述",
      }));
  }

  async function runPlanning() {
    setRunning(true);
    setError("");
    setPendingApproval(null);

    try {
      const response = await fetch("/api/agents/listing/executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          naturalLanguageGoal: goal,
          marketplace,
          category: category || undefined,
          productReport: selectedHandoff && typeof selectedHandoff === "object" && "productReport" in selectedHandoff ? asProductReport(selectedHandoff.productReport) : undefined,
          marketReport: selectedHandoff && typeof selectedHandoff === "object" && "marketReport" in selectedHandoff ? asMarketReport(selectedHandoff.marketReport) : undefined,
          productOpportunity: selectedHandoff && typeof selectedHandoff === "object" && "productOpportunity" in selectedHandoff ? asOpportunity(selectedHandoff.productOpportunity) : undefined,
          sellerSpriteKeywords: buildKeywordPayload(),
          competitors: buildCompetitorPayload(),
          context: {
            currentData: {
              goal,
              marketplace,
              category,
              sellerSpriteKeywords: buildKeywordPayload(),
              competitors: buildCompetitorPayload(),
              productReport: selectedHandoff && typeof selectedHandoff === "object" ? selectedHandoff.productReport : undefined,
              marketReport: selectedHandoff && typeof selectedHandoff === "object" ? selectedHandoff.marketReport : undefined,
            },
          },
        } satisfies ListingExecutionRequest),
      });
      const payload = (await response.json()) as ListingExecutionResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "运行刊登 Agent 失败。");

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
      setError(err instanceof Error ? err.message : "运行刊登 Agent 失败。");
    } finally {
      setRunning(false);
    }
  }

  async function createProject() {
    if (!report) return;
    setProjecting(true);
    setError("");

    try {
      const response = await fetch("/api/agents/listing/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report,
          marketplace: report.marketplace,
          context: {
            currentData: {
              marketplace: report.marketplace,
              category: report.category,
              title: report.titleDraft.title,
            },
          },
        }),
      });
      const payload = (await response.json()) as ListingProjectResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "创建刊登项目审批失败。");

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
      setError(err instanceof Error ? err.message : "创建刊登项目审批失败。");
    } finally {
      setProjecting(false);
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
          reason: decision === "APPROVED" ? "已由刊登 Agent 审批通过。" : "已由刊登 Agent 审批驳回。",
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "处理审批失败。");
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
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="关键词" value={report?.keywordMap.primaryKeywords.length ?? 0} icon={<Sparkles className="h-5 w-5 text-brand" />} />
        <MetricCard label="要点" value={report?.bulletDrafts.length ?? 0} icon={<FileText className="h-5 w-5 text-brand" />} />
        <MetricCard label="工具调用" value={currentExecution?.toolCallCount ?? 0} icon={<Clock3 className="h-5 w-5 text-brand" />} />
        <MetricCard label="记忆条目" value={memoryItems.length} icon={<SquareKanban className="h-5 w-5 text-brand" />} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>刊登简报</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {error ? <div className="rounded-md border border-danger/30 bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{error}</div> : null}
            {selectedHandoff ? (
              <div className="rounded-md border border-brand/20 bg-brand/5 p-3">
                <div className="text-xs font-bold uppercase tracking-wide text-muted">产品交接</div>
                <div className="mt-1 text-sm font-semibold text-foreground">已导入的产品方案</div>
              </div>
            ) : null}
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted">目标</span>
              <textarea value={goal} onChange={(event) => setGoal(event.target.value)} className="min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-brand" />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted">站点</span>
                <input value={marketplace} onChange={(event) => setMarketplace(event.target.value.toUpperCase())} className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted">类目</span>
                <input value={category} onChange={(event) => setCategory(event.target.value)} className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand" />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted">SellerSprite 关键词</span>
              <textarea value={keywordsInput} onChange={(event) => setKeywordsInput(event.target.value)} className="min-h-24 w-full rounded-md border border-border px-3 py-2 text-xs outline-none focus:border-brand" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted">竞品</span>
              <textarea value={competitorsInput} onChange={(event) => setCompetitorsInput(event.target.value)} className="min-h-24 w-full rounded-md border border-border px-3 py-2 text-xs outline-none focus:border-brand" />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={runPlanning} disabled={running || loading}>
                {running ? "运行中..." : "运行刊登 Agent"}
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button type="button" onClick={createProject} disabled={projecting || !report}>
                {projecting ? "创建中..." : "请求人工审批"}
                <SquareKanban className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>审批</CardTitle>
              <p className="mt-1 text-xs font-medium text-muted">刊登草稿进入审批后在这里处理。</p>
            </div>
            {currentApproval ? <Badge tone={currentApproval.status === "APPROVED" ? "green" : currentApproval.status === "REJECTED" ? "red" : "amber"}>{currentApproval.status}</Badge> : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {currentApproval ? (
              <>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">动作</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{currentApproval.action.type}</div>
                  <div className="mt-2 text-xs text-muted">{currentApproval.recommendation.summary}</div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" onClick={() => resolveApproval("APPROVED")} disabled={decisionBusy !== "" || currentApproval.status !== "REQUESTED"}>
                    {decisionBusy === "APPROVED" ? "审批中..." : "通过"}
                    <CheckCircle2 className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="danger" onClick={() => resolveApproval("REJECTED")} disabled={decisionBusy !== "" || currentApproval.status !== "REQUESTED"}>
                    {decisionBusy === "REJECTED" ? "驳回中..." : "驳回"}
                    <TriangleAlert className="h-4 w-4" />
                  </Button>
                </div>
              </>
            ) : (
              <EmptyState text="暂无待处理审批。" />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader><CardTitle>关键词图谱</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {report ? report.keywordMap.groups.map((group) => (
              <div key={group.placement} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-foreground">{group.placement}</div>
                  <Badge tone="blue">{group.intent}</Badge>
                </div>
                <div className="mt-2 text-xs text-muted">{group.keywords.join(" / ")}</div>
              </div>
            )) : <EmptyState text="暂无关键词图谱。" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>标题</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {report ? (
              <>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">标题</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{report.titleDraft.title}</div>
                </div>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">原因</div>
                  <div className="mt-1 text-xs text-muted">{report.titleDraft.rationale}</div>
                </div>
              </>
            ) : <EmptyState text="暂无标题草稿。" />}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader><CardTitle>要点</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {report?.bulletDrafts.length ? report.bulletDrafts.map((item) => (
              <div key={item.bullet} className="rounded-md border border-border p-3">
                <div className="text-sm font-semibold text-foreground">{item.bullet}</div>
                <div className="mt-1 text-xs text-muted">{item.benefit}</div>
              </div>
            )) : <EmptyState text="暂无要点。" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>描述与 A+</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {report ? (
              <>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">描述</div>
                  <div className="mt-1 text-sm text-foreground">{report.descriptionDraft.paragraphs.join(" ")}</div>
                </div>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">A+ 简报</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{report.aplusBrief.objective}</div>
                </div>
              </>
            ) : <EmptyState text="暂无描述或 A+ 简报。" />}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader><CardTitle>刊登草稿</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {report ? (
              <>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">后台词</div>
                  <div className="mt-1 text-xs text-foreground">{report.listingDraft.backendSearchTerms}</div>
                </div>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">建议</div>
                  <div className="mt-1 text-sm text-foreground">{report.listingDraft.recommendation}</div>
                </div>
              </>
            ) : <EmptyState text="暂无刊登草稿。" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>执行时间线</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {traces.length ? traces.map((trace) => (
              <div key={trace.id} className="rounded-md border border-border bg-white px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-foreground">{trace.type}</div>
                  <div className="text-[11px] text-muted">{formatDate(trace.createdAt)}</div>
                </div>
                {trace.message ? <div className="mt-1 text-xs text-muted">{trace.message}</div> : null}
              </div>
            )) : <EmptyState text="暂无执行轨迹。" />}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader><CardTitle>工具调用</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {toolCalls.length ? toolCalls.map((toolCall) => (
              <div key={toolCall.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-foreground">{toolCall.toolName}</div>
                  <Badge tone={toolCall.riskLevel === "CRITICAL" ? "red" : toolCall.riskLevel === "HIGH" ? "amber" : toolCall.riskLevel === "MEDIUM" ? "blue" : "gray"}>{toolCall.riskLevel}</Badge>
                </div>
                <div className="mt-1 text-[11px] text-muted">{toolCall.toolId}</div>
              </div>
            )) : <EmptyState text="当前执行暂无工具调用。" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>证据</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {report?.evidence.length ? report.evidence.map((item, index) => (
              <div key={`${item.metric}-${index}`} className="rounded-md border border-border p-3">
                <div className="text-sm font-semibold text-foreground">{item.metric}</div>
                <div className="mt-1 text-xs text-muted">{item.dataSource}</div>
              </div>
            )) : <EmptyState text="暂无证据。" />}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader><CardTitle>记忆</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {memoryItems.length ? memoryItems.map((memory) => (
              <div key={memory.id} className="rounded-md border border-border p-3">
                <div className="text-sm font-semibold text-foreground">{memory.summary}</div>
                <div className="mt-1 text-[11px] text-muted">{memory.scope} / {memory.scopeKey}</div>
              </div>
            )) : <EmptyState text="暂无记忆条目。" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>摘要</CardTitle></CardHeader>
          <CardContent>
            {report ? <div className="text-sm text-foreground">{report.summary}</div> : <EmptyState text="暂无摘要。" />}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        {icon}
        <div>
          <div className="text-lg font-black text-foreground">{value}</div>
          <div className="text-xs font-medium text-muted">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed border-border p-4 text-sm font-semibold text-muted">{text}</div>;
}
