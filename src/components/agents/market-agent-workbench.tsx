"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileText, RefreshCw, Sparkles, SquareKanban, ShieldAlert, TriangleAlert } from "lucide-react";
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
import type { AgentRuntimeConfigStatus } from "@/lib/agent-platform/runtime-config";
import { productHandoffStorageKey } from "@/lib/agent-platform/product";
import type { MarketExecutionOutput, MarketResearchReport, ProductOpportunity } from "@/lib/agent-platform/market";

type MarketAgentResponse = {
  agent: AgentCenterItem;
  tools: AgentToolDefinition[];
  executions: AgentExecutionSummary[];
  latestExecution: AgentExecutionDetail | null;
  memoryItems: AgentMemoryEntry[];
  runtimeConfig?: AgentRuntimeConfigStatus;
};

type MarketExecutionResponse = {
  execution: Omit<AgentExecutionDetail, "approvals" | "toolCalls" | "traces" | "events">;
  executions: AgentExecutionSummary[];
  approvals: AgentApproval[];
  toolCalls: AgentToolCall[];
  traces: AgentTraceEvent[];
  events: unknown[];
};

type MarketProjectResponse = {
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

function parseRange(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  const [minRaw, maxRaw] = trimmed.split("-").map((item) => item.trim());
  const min = minRaw ? Number(minRaw) : undefined;
  const max = maxRaw ? Number(maxRaw) : undefined;

  if (!Number.isFinite(min ?? NaN) && !Number.isFinite(max ?? NaN)) {
    return undefined;
  }

  return {
    min: Number.isFinite(min ?? NaN) ? min : undefined,
    max: Number.isFinite(max ?? NaN) ? max : undefined,
  };
}

function parseMarketOutput(output: unknown): MarketExecutionOutput | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;

  const record = output as Record<string, unknown>;
  const report = record.report as MarketResearchReport | undefined;

  if (report && typeof report === "object") {
    return {
      report,
      blueOceanRadar: (record.blueOceanRadar as MarketExecutionOutput["blueOceanRadar"]) ?? report.blueOceanRadar,
      productOpportunities: (record.productOpportunities as ProductOpportunity[]) ?? report.productOpportunities ?? [],
      evidence: (record.evidence as MarketExecutionOutput["evidence"]) ?? report.evidence ?? [],
      memoryItems: [],
    };
  }

  const reportSnapshot = record.reportSnapshot as MarketResearchReport | undefined;
  if (reportSnapshot && typeof reportSnapshot === "object") {
    return {
      report: reportSnapshot,
      blueOceanRadar: reportSnapshot.blueOceanRadar,
      productOpportunities: reportSnapshot.productOpportunities ?? [],
      evidence: reportSnapshot.evidence ?? [],
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
  if (score >= 75) return "green";
  if (score >= 55) return "blue";
  if (score >= 40) return "amber";
  return "red";
}

function riskTone(score: number) {
  if (score >= 70) return "red";
  if (score >= 50) return "amber";
  return "green";
}

function sellerSpriteStatusLabel(status?: string) {
  if (status === "configured") return "真实 MCP 已配置";
  if (status === "missing_credentials") return "缺少连接信息";
  return "使用模拟数据";
}

function sellerSpriteStatusTone(status?: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (status === "configured") return "green";
  if (status === "missing_credentials") return "red";
  return "gray";
}

export function MarketAgentWorkbench() {
  const [data, setData] = useState<MarketAgentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [running, setRunning] = useState(false);
  const [projecting, setProjecting] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState<"APPROVED" | "REJECTED" | "">("");
  const [goal, setGoal] = useState("寻找美国站售价20-50美元、竞争中等以下、Review 低于 500、利润率 25% 以上的产品");
  const [marketplace, setMarketplace] = useState("US");
  const [category, setCategory] = useState("");
  const [keyword, setKeyword] = useState("");
  const [asin, setAsin] = useState("");
  const [competition, setCompetition] = useState("medium_low");
  const [priceMin, setPriceMin] = useState("20");
  const [priceMax, setPriceMax] = useState("50");
  const [salesMin, setSalesMin] = useState("");
  const [salesMax, setSalesMax] = useState("");
  const [reviewMin, setReviewMin] = useState("");
  const [reviewMax, setReviewMax] = useState("500");
  const [targetMargin, setTargetMargin] = useState("25");
  const [constraints, setConstraints] = useState("");
  const [selectedOpportunityId, setSelectedOpportunityId] = useState("");
  const [pendingApproval, setPendingApproval] = useState<AgentApproval | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    fetch("/api/agents/market")
      .then(async (response) => {
        const payload = (await response.json()) as MarketAgentResponse & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || "加载市场 Agent 失败。");
        }

        if (!cancelled) {
          setData(payload);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载市场 Agent 失败。");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const currentExecution = data?.latestExecution ?? null;
  const marketExecution = useMemo(() => parseMarketOutput(currentExecution?.output), [currentExecution?.output]);
  const report = marketExecution?.report ?? null;
  const opportunities = useMemo(() => report?.productOpportunities ?? [], [report]);
  const selectedOpportunity = opportunities.find((item) => item.opportunityId === selectedOpportunityId) ?? opportunities[0] ?? null;
  const currentApproval = getCurrentApproval(currentExecution, pendingApproval);

  useEffect(() => {
    if (opportunities.length) {
      setSelectedOpportunityId((current) => (opportunities.some((item) => item.opportunityId === current) ? current : opportunities[0].opportunityId));
    } else {
      setSelectedOpportunityId("");
    }
  }, [opportunities]);

  async function refresh() {
    setRefreshToken((current) => current + 1);
  }

  async function runResearch() {
    setRunning(true);
    setError("");
    setPendingApproval(null);
    const parsedTargetMargin = targetMargin.trim() ? Number(targetMargin) : undefined;

    try {
      const response = await fetch("/api/agents/market/executions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          naturalLanguageGoal: goal,
          marketplace,
          category: category || undefined,
          keyword: keyword || undefined,
          asin: asin || undefined,
          competition,
          priceRange: parseRange([priceMin, priceMax].filter(Boolean).join("-")),
          salesRange: parseRange([salesMin, salesMax].filter(Boolean).join("-")),
          reviewRange: parseRange([reviewMin, reviewMax].filter(Boolean).join("-")),
          targetMargin: Number.isFinite(parsedTargetMargin ?? NaN) ? parsedTargetMargin : undefined,
          productConstraints: constraints
            .split(/[\n,]/)
            .map((item) => item.trim())
            .filter(Boolean),
          context: {
            currentData: {
              goal,
              marketplace,
              category,
              keyword,
              asin,
              competition,
            },
          },
        }),
      });
      const payload = (await response.json()) as MarketExecutionResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "运行市场 Agent 失败。");
      }

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
      setSelectedOpportunityId("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "运行市场 Agent 失败。");
    } finally {
      setRunning(false);
    }
  }

  async function createProject() {
    if (!selectedOpportunity || !report) return;

    setProjecting(true);
    setError("");

    try {
      const response = await fetch("/api/agents/market/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          opportunity: selectedOpportunity,
          report,
          marketplace: report.marketplace,
          context: {
            currentData: {
              marketplace: report.marketplace,
              category: report.category,
              keyword: report.keyword,
              asin: report.asin,
            },
          },
        }),
      });
      const payload = (await response.json()) as MarketProjectResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "创建项目审批失败。");
      }

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
      setError(err instanceof Error ? err.message : "创建项目审批失败。");
    } finally {
      setProjecting(false);
    }
  }

  function handoffToProductAgent() {
    if (!selectedOpportunity || !report || typeof window === "undefined") return;

    const payload = {
      goal,
      marketplace: report.marketplace,
      category: report.category ?? selectedOpportunity.category,
      productConstraints: constraints
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
      marketOpportunity: selectedOpportunity,
      marketReport: report,
    };

    window.sessionStorage.setItem(productHandoffStorageKey, JSON.stringify(payload));
    window.location.href = "/agents/product";
  }

  async function resolveApproval(decision: "APPROVED" | "REJECTED") {
    if (!currentApproval) return;

    setDecisionBusy(decision);
    setError("");

    try {
      const response = await fetch(`/api/agents/approvals/${currentApproval.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          decision,
          reason: decision === "APPROVED" ? "已由市场 Agent 审批通过。" : "已由市场 Agent 审批驳回。",
        }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "处理审批失败。");
      }

      setPendingApproval(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "处理审批失败。");
    } finally {
      setDecisionBusy("");
    }
  }

  const toolCalls = currentExecution?.toolCalls ?? [];
  const traces = currentExecution?.traces ?? [];
  const memoryItems = data?.memoryItems ?? [];
  const metrics = useMemo(() => {
    const blueOceanIndex = report?.blueOceanRadar.blueOceanIndex ?? 0;
    const demand = report?.blueOceanRadar.demandStrength ?? 0;
    const competitionScore = report?.blueOceanRadar.competitionStrength ?? 0;
    const margin = selectedOpportunity?.estimatedMargin ?? 0;
    return {
      blueOceanIndex,
      demand,
      competitionScore,
      margin,
      tokenUsage: currentExecution?.tokenUsage ?? 0,
      toolCalls: currentExecution?.toolCallCount ?? 0,
    };
  }, [currentExecution?.tokenUsage, currentExecution?.toolCallCount, report, selectedOpportunity]);

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="text-sm font-black text-foreground">AI 大模型</div>
              <div className="mt-1 truncate text-xs font-semibold text-muted">
                {data?.runtimeConfig?.ai.provider ?? "已保存配置"} · {data?.runtimeConfig?.ai.model ?? "未读取配置"}
              </div>
            </div>
            <Badge tone={data?.runtimeConfig?.ai.enabled && data.runtimeConfig.ai.hasApiKey ? "green" : "amber"}>
              {data?.runtimeConfig?.ai.enabled && data.runtimeConfig.ai.hasApiKey ? "已保存系统配置" : "待配置"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="text-sm font-black text-foreground">SellerSprite MCP</div>
              <div className="mt-1 truncate text-xs font-semibold text-muted">
                {data?.runtimeConfig?.integrations.sellerSprite.serverUrl || "未配置服务地址"}
              </div>
            </div>
            <Badge tone={sellerSpriteStatusTone(data?.runtimeConfig?.integrations.sellerSprite.status)}>
              {sellerSpriteStatusLabel(data?.runtimeConfig?.integrations.sellerSprite.status)}
            </Badge>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Sparkles className="h-5 w-5 text-brand" />
            <div>
              <div className="text-lg font-black text-foreground">{metrics.blueOceanIndex}</div>
              <div className="text-xs font-medium text-muted">蓝海指数</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-5 w-5 text-brand" />
            <div>
              <div className="text-lg font-black text-foreground">{metrics.demand}</div>
              <div className="text-xs font-medium text-muted">需求强度</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <ShieldAlert className="h-5 w-5 text-brand" />
            <div>
              <div className="text-lg font-black text-foreground">{metrics.competitionScore}</div>
              <div className="text-xs font-medium text-muted">竞争强度</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <SquareKanban className="h-5 w-5 text-brand" />
            <div>
              <div className="text-lg font-black text-foreground">{metrics.margin}%</div>
              <div className="text-xs font-medium text-muted">预计利润率</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Clock3 className="h-5 w-5 text-brand" />
            <div>
              <div className="text-lg font-black text-foreground">{metrics.toolCalls}</div>
              <div className="text-xs font-medium text-muted">工具调用</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <FileText className="h-5 w-5 text-brand" />
            <div>
              <div className="text-lg font-black text-foreground">{memoryItems.length}</div>
              <div className="text-xs font-medium text-muted">记忆条目</div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader className="flex flex-col gap-2">
            <CardTitle>研究简报</CardTitle>
            <p className="text-xs font-medium text-muted">输入自然语言目标和筛选条件，市场 Agent 会给出带证据的产品机会。</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {error ? <div className="rounded-md border border-danger/30 bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{error}</div> : null}
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
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted">关键词</span>
                <input value={keyword} onChange={(event) => setKeyword(event.target.value)} className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted">ASIN</span>
                <input value={asin} onChange={(event) => setAsin(event.target.value)} className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand" />
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted">价格</span>
                <div className="flex items-center gap-2">
                  <input value={priceMin} onChange={(event) => setPriceMin(event.target.value)} placeholder="最小" className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand" />
                  <input value={priceMax} onChange={(event) => setPriceMax(event.target.value)} placeholder="最大" className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand" />
                </div>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted">销量</span>
                <div className="flex items-center gap-2">
                  <input value={salesMin} onChange={(event) => setSalesMin(event.target.value)} placeholder="最小" className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand" />
                  <input value={salesMax} onChange={(event) => setSalesMax(event.target.value)} placeholder="最大" className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand" />
                </div>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted">Review</span>
                <div className="flex items-center gap-2">
                  <input value={reviewMin} onChange={(event) => setReviewMin(event.target.value)} placeholder="最小" className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand" />
                  <input value={reviewMax} onChange={(event) => setReviewMax(event.target.value)} placeholder="最大" className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand" />
                </div>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted">目标利润率 %</span>
                <input value={targetMargin} onChange={(event) => setTargetMargin(event.target.value)} className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand" />
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted">竞争层级</span>
                <input value={competition} onChange={(event) => setCompetition(event.target.value)} className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted">产品约束</span>
                <textarea value={constraints} onChange={(event) => setConstraints(event.target.value)} className="min-h-20 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-brand" />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={runResearch} disabled={running || loading} className="min-w-36">
                {running ? "运行中..." : "运行研究"}
                <Sparkles className="h-4 w-4" />
              </Button>
              <Button type="button" variant="secondary" onClick={createProject} disabled={projecting || !selectedOpportunity || !report}>
                {projecting ? "创建中..." : "创建项目"}
                <SquareKanban className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" onClick={handoffToProductAgent} disabled={!selectedOpportunity || !report}>
                发送到产品 Agent
                <Sparkles className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" onClick={() => refresh()} disabled={loading}>
                <RefreshCw className="h-4 w-4" />
                刷新
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>研究报告</CardTitle>
                <p className="mt-1 text-xs font-medium text-muted">蓝海雷达、信号摘要和推荐下一步操作。</p>
              </div>
              <Badge tone={badgeTone(metrics.blueOceanIndex)}>{metrics.blueOceanIndex}/100</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {report ? (
                <>
                  <div className="grid gap-3 md:grid-cols-3">
                    <MetricBox label="需求" value={report.blueOceanRadar.demandStrength} tone="blue" />
                    <MetricBox label="竞争" value={report.blueOceanRadar.competitionStrength} tone="amber" />
                    <MetricBox label="进入门槛" value={report.blueOceanRadar.entryBarrier} tone="red" />
                  </div>
                  <div className="rounded-md border border-border bg-surface-muted p-3">
                    <div className="text-xs font-bold uppercase tracking-wide text-muted">摘要</div>
                    <p className="mt-2 text-sm leading-6 text-foreground">{report.summary}</p>
                  </div>
                  <div className="rounded-md border border-border p-3">
                    <div className="text-xs font-bold uppercase tracking-wide text-muted">建议</div>
                    <p className="mt-2 text-sm leading-6 text-foreground">{report.recommendation}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="gray">{report.marketplace}</Badge>
                    {report.category ? <Badge tone="gray">{report.category}</Badge> : null}
                    {report.keyword ? <Badge tone="gray">{report.keyword}</Badge> : null}
                    {report.asin ? <Badge tone="gray">{report.asin}</Badge> : null}
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-dashed border-border p-4 text-sm font-semibold text-muted">
                  没有可展示的报告。先运行一次研究。
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>审批</CardTitle>
                <p className="mt-1 text-xs font-medium text-muted">创建项目后，这里会出现待审批动作。</p>
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
                <div className="rounded-md border border-dashed border-border p-4 text-sm font-semibold text-muted">
                  暂无待处理审批。
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
          <CardTitle>产品机会</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {opportunities.length ? (
              <div className="space-y-2">
                {opportunities.map((opportunity) => (
                  <button
                    key={opportunity.opportunityId}
                    type="button"
                    onClick={() => setSelectedOpportunityId(opportunity.opportunityId)}
                    className={`w-full rounded-md border px-3 py-3 text-left transition ${
                      selectedOpportunity?.opportunityId === opportunity.opportunityId
                        ? "border-brand bg-brand/5"
                        : "border-border hover:bg-surface-muted"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{opportunity.productIdea}</div>
                        <div className="mt-1 text-xs text-muted">{opportunity.recommendation}</div>
                      </div>
                      <Badge tone={badgeTone(opportunity.opportunityScore)}>{opportunity.opportunityScore}/100</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge tone="gray">需求 {opportunity.estimatedDemand}</Badge>
                      <Badge tone={riskTone(opportunity.riskScore)}>风险 {opportunity.riskScore}</Badge>
                      <Badge tone="gray">置信度 {Math.round(opportunity.confidence * 100)}%</Badge>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border p-4 text-sm font-semibold text-muted">
                暂无机会。
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
          <CardTitle>机会证据</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedOpportunity ? (
              <>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">目标售价</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{selectedOpportunity.targetPrice}</div>
                  <div className="mt-2 text-xs text-muted">站点 {selectedOpportunity.marketplace} / {selectedOpportunity.category}</div>
                </div>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">证据数量</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{selectedOpportunity.evidence.length}</div>
                  <div className="mt-2 text-xs text-muted">每条结论都应核对工具输出和时间戳。</div>
                </div>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="bg-surface-muted text-xs font-bold text-muted">
                      <tr>
                        <th className="px-3 py-2 text-left">指标</th>
                        <th className="px-3 py-2 text-left">来源</th>
                        <th className="px-3 py-2 text-left">数值</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-white">
                      {selectedOpportunity.evidence.map((item, index) => (
                        <tr key={`${item.metric}-${index}`}>
                          <td className="px-3 py-2 text-xs font-semibold text-foreground">{item.metric}</td>
                          <td className="px-3 py-2 text-xs text-muted">{item.dataSource}</td>
                          <td className="px-3 py-2 text-xs text-muted">{JSON.stringify(item.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="rounded-md border border-dashed border-border p-4 text-sm font-semibold text-muted">
                选择一个机会查看证据。
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>执行时间线</CardTitle>
              <p className="mt-1 text-xs font-medium text-muted">研究执行和审批流程。</p>
            </div>
            <Badge tone={currentExecution?.status === "COMPLETED" ? "green" : currentExecution?.status === "WAITING_APPROVAL" ? "amber" : "gray"}>{currentExecution?.status ?? "-"}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {traces.length ? (
              traces.map((trace) => <TimelineRow key={trace.id} trace={trace} />)
            ) : (
              <div className="rounded-md border border-dashed border-border p-4 text-sm font-semibold text-muted">
                暂无执行轨迹。
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>工具调用</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {toolCalls.length ? (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-surface-muted text-xs font-bold text-muted">
                    <tr>
                      <th className="px-3 py-2 text-left">工具</th>
                      <th className="px-3 py-2 text-left">风险</th>
                      <th className="px-3 py-2 text-left">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-white">
                    {toolCalls.map((toolCall) => (
                      <tr key={toolCall.id}>
                        <td className="px-3 py-2">
                          <div className="text-xs font-semibold text-foreground">{toolCall.toolName}</div>
                          <div className="mt-1 text-[11px] text-muted">{toolCall.toolId}</div>
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={toolCall.riskLevel === "CRITICAL" ? "red" : toolCall.riskLevel === "HIGH" ? "amber" : toolCall.riskLevel === "MEDIUM" ? "blue" : "gray"}>{toolCall.riskLevel}</Badge>
                        </td>
                        <td className="px-3 py-2 text-xs font-semibold text-muted">{toolCall.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border p-4 text-sm font-semibold text-muted">
                当前执行暂无工具调用。
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>最近运行</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-surface-muted text-xs font-bold text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">运行</th>
                  <th className="px-3 py-2 text-left">状态</th>
                  <th className="px-3 py-2 text-left">Token</th>
                  <th className="px-3 py-2 text-left">工具</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-white">
                {(data?.executions ?? []).map((execution) => (
                  <tr key={execution.id}>
                    <td className="px-3 py-2">
                      <div className="text-xs font-semibold text-foreground">{execution.id}</div>
                      <div className="mt-1 text-[11px] text-muted">{formatDate(execution.createdAt)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold text-muted">{execution.status}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-muted">{execution.tokenUsage}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-muted">{execution.toolCallCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>记忆</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {memoryItems.length ? (
              memoryItems.map((item) => (
                <div key={item.id} className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">{item.scope}</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{item.summary}</div>
                  <div className="mt-2 text-[11px] text-muted">{item.scopeKey}</div>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-border p-4 text-sm font-semibold text-muted">
                暂无记忆记录。
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function MetricBox({ label, value, tone }: { label: string; value: number; tone: "blue" | "amber" | "red" }) {
  return (
    <div className="rounded-md border border-border bg-surface-muted px-3 py-2">
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${tone === "blue" ? "text-brand" : tone === "amber" ? "text-amber-700" : "text-danger"}`}>{value}</div>
    </div>
  );
}

function TimelineRow({ trace }: { trace: AgentTraceEvent }) {
  return (
    <div className="rounded-md border border-border bg-surface-muted px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-bold uppercase tracking-wide text-muted">{trace.type}</div>
        <div className="text-[11px] text-muted">{formatDate(trace.createdAt)}</div>
      </div>
      {trace.message ? <div className="mt-1 text-sm font-semibold text-foreground">{trace.message}</div> : null}
    </div>
  );
}
