"use client";

import { executionMatchesHandoff } from "@/lib/agent-platform/handoff";

import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { ChainHandoffNotice, chainFetch, chainHeaders, sendChainHandoff, useChainHandoff, rememberChainExecution } from "./chain-handoff";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileText, RefreshCw, ShieldAlert, Sparkles, SquareKanban, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StandardDataTable } from "@/components/ui/table-variants";
import { type DataTableColumn } from "@/components/ui/data-table";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkbenchPageTemplate } from "@/components/templates/page-templates";
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
import { type ProductDevelopmentReport, type ProductEvidenceItem, type ProductExecutionOutput, type ProductHandoffPayload, type ProductProjectDraft } from "@/lib/agent-platform/product";

type ProductAgentResponse = {
  agent: AgentCenterItem;
  tools: AgentToolDefinition[];
  executions: AgentExecutionSummary[];
  latestExecution: AgentExecutionDetail | null;
  memoryItems: AgentMemoryEntry[];
};

type ProductExecutionResponse = {
  execution: Omit<AgentExecutionDetail, "approvals" | "toolCalls" | "traces" | "events">;
  executions: AgentExecutionSummary[];
  approvals: AgentApproval[];
  toolCalls: AgentToolCall[];
  traces: AgentTraceEvent[];
  events: unknown[];
};

type ProductProjectResponse = {
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

function parseProductOutput(output: unknown): ProductExecutionOutput | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;

  const record = output as Record<string, unknown>;
  const report = record.report as ProductDevelopmentReport | undefined;

  if (report && typeof report === "object") {
    return {
      report,
      evidence: (record.evidence as ProductExecutionOutput["evidence"]) ?? report.evidence ?? [],
      memoryItems: [],
    };
  }

  return null;
}

function getCurrentApproval(execution?: AgentExecutionDetail | null, fallback?: AgentApproval | null) {
  const requested = execution?.approvals?.find((approval) => approval.status === "REQUESTED");
  return requested ?? execution?.approvals?.[0] ?? fallback ?? null;
}

function riskTone(score: number) {
  if (score >= 70) return "red";
  if (score >= 50) return "amber";
  return "green";
}

export function ProductAgentWorkbench() {
  const shellUser = useAppShellUser();
  const chain = useChainHandoff("product");
  const canApprove = roleCanPerformAction(shellUser?.userRole, "agents", "approve", shellUser?.rolePermissions);
  const canCreate = roleCanPerformAction(shellUser?.userRole, "agents", "create", shellUser?.rolePermissions);
  const [data, setData] = useState<ProductAgentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [running, setRunning] = useState(false);
  const [projecting, setProjecting] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState<"APPROVED" | "REJECTED" | "">("");
  const [goal, setGoal] = useState("把 market opportunity 转成 PRD、成本目标和产品项目");
  const [marketplace, setMarketplace] = useState("US");
  const [category, setCategory] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [targetCost, setTargetCost] = useState("");
  const [targetMargin, setTargetMargin] = useState("30");
  const [constraints, setConstraints] = useState("");
  const [selectedHandoff, setSelectedHandoff] = useState<ProductHandoffPayload | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [pendingApproval, setPendingApproval] = useState<AgentApproval | null>(null);

  useEffect(() => {
    const reset = () => { setData(null); setRefreshToken((value) => value + 1); setPendingApproval(null); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, []);

  useEffect(() => {
    const parsed = chain.payload as ProductHandoffPayload;
    if (!parsed) { setSelectedHandoff(null); return; }
      setSelectedHandoff(parsed);
      if (parsed.goal) setGoal(parsed.goal);
      if (parsed.marketplace) setMarketplace(parsed.marketplace);
      if (parsed.category) setCategory(parsed.category);
      if (parsed.marketOpportunity?.targetPrice) setTargetPrice(String(parsed.marketOpportunity.targetPrice));
      if (parsed.marketOpportunity?.estimatedMargin) setTargetMargin(String(parsed.marketOpportunity.estimatedMargin));
      if (Array.isArray(parsed.productConstraints)) setConstraints(parsed.productConstraints.join("\n"));
  }, [chain.payload]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    chainFetch(`/api/agents/product${window.location.search}`, { headers: chainHeaders(), cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as ProductAgentResponse & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || "加载产品 Agent 失败。");
        }

        if (!cancelled) {
          setData(payload);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载产品 Agent 失败。");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const currentExecution = executionMatchesHandoff(data?.latestExecution, chain.payload) ? data?.latestExecution ?? null : null;
  const productExecution = useMemo(() => parseProductOutput(currentExecution?.output), [currentExecution?.output]);
  const report = productExecution?.report ?? null;
  const currentApproval = getCurrentApproval(currentExecution, pendingApproval);
  const selectedProject = report?.projectDraft ?? null;
  const selectedOpportunity = report?.sourceOpportunity ?? selectedHandoff?.marketOpportunity ?? null;
  const selectedMarketReport = report?.sourceMarketReport ?? selectedHandoff?.marketReport ?? null;

  useEffect(() => {
    if (!selectedProjectId && selectedProject) {
      setSelectedProjectId(selectedProject.projectName);
    }
  }, [selectedProject, selectedProjectId]);

  async function refresh() {
    setRefreshToken((current) => current + 1);
  }

  async function runPlanning() {
    setRunning(true);
    setError("");
    setPendingApproval(null);

    const parsedTargetMargin = targetMargin.trim() ? Number(targetMargin) : undefined;

    try {
      const response = await chainFetch("/api/agents/product/executions", {
        method: "POST",
        headers: chainHeaders(true),
        body: JSON.stringify({
          chainHandoff: chain.payload ?? undefined,
          naturalLanguageGoal: goal,
          marketplace,
          category: category || undefined,
          targetPrice: parseRange(targetPrice),
          targetCost: parseRange(targetCost),
          targetMargin: Number.isFinite(parsedTargetMargin ?? NaN) ? parsedTargetMargin : undefined,
          productConstraints: constraints
            .split(/[\n,]/)
            .map((item) => item.trim())
            .filter(Boolean),
          marketOpportunity: selectedOpportunity ?? undefined,
          marketReport: selectedMarketReport ?? undefined,
          context: {
            currentData: {
              goal,
              marketplace,
              category,
              targetPrice,
              targetCost,
              marketOpportunity: selectedOpportunity,
              marketReport: selectedMarketReport,
            },
          },
        }),
      });
      const payload = (await response.json()) as ProductExecutionResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "运行产品 Agent 失败。");
      }

      rememberChainExecution(payload.execution.id);
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
      setError(err instanceof Error ? err.message : "运行产品 Agent 失败。");
    } finally {
      setRunning(false);
    }
  }

  async function createProject() {
    if (!report) return;

    setProjecting(true);
    setError("");

    try {
      const response = await chainFetch("/api/agents/product/projects", {
        method: "POST",
        headers: chainHeaders(true),
        body: JSON.stringify({
          report,
          opportunity: report.sourceOpportunity,
          marketplace: report.marketplace,
          context: {
            currentData: {
              marketplace: report.marketplace,
              category: report.category,
              projectName: report.projectDraft.projectName,
            },
          },
        }),
      });
      const payload = (await response.json()) as ProductProjectResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "创建产品项目审批失败。");
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
      setError(err instanceof Error ? err.message : "创建产品项目审批失败。");
    } finally {
      setProjecting(false);
    }
  }

  function handoffToSupplierAgent() {
    if (!report || typeof window === "undefined") return;

    const payload = {
      goal,
      marketplace: report.marketplace,
      category: report.category,
      productReport: report,
      prd: report.prd,
      productHandoff: selectedHandoff ?? undefined,
    };

    try {
      sendChainHandoff({ previous: chain.payload, from: "product", to: "supplier", payload, sourceExecutionId: currentExecution?.id ?? "", sourceWorkspaceId: currentExecution?.workspaceId, organizationId: shellUser?.organizationId, userId: shellUser?.userId, kind: "PRD" });
    } catch (err) { setError(err instanceof Error ? err.message : "交接失败。"); }
  }

  function handoffToListingAgent() {
    if (!report || typeof window === "undefined") return;

    const payload = {
      goal,
      marketplace: report.marketplace,
      category: report.category,
      productReport: report,
      marketReport: selectedMarketReport,
      productOpportunity: selectedOpportunity,
      productHandoff: selectedHandoff ?? undefined,
    };

    try {
      sendChainHandoff({ previous: chain.payload, from: "product", to: "listing", payload, sourceExecutionId: currentExecution?.id ?? "", sourceWorkspaceId: currentExecution?.workspaceId, organizationId: shellUser?.organizationId, userId: shellUser?.userId, kind: "PRD" });
    } catch (err) { setError(err instanceof Error ? err.message : "交接失败。"); }
  }

  async function resolveApproval(decision: "APPROVED" | "REJECTED") {
    if (!currentApproval) return;

    setDecisionBusy(decision);
    setError("");

    try {
      const response = await chainFetch(`/api/agents/approvals/${currentApproval.id}`, {
        method: "POST",
        headers: chainHeaders(true),
        body: JSON.stringify({
          decision,
                reason: decision === "APPROVED" ? "已由产品 Agent 审批通过。" : "已由产品 Agent 审批驳回。",
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
  const prdColumns: DataTableColumn<{ mustHave: string[]; shouldHave: string[] }>[] = [
    { key: "mustHave", header: "必须具备", render: (r) => (<ul className="space-y-1 text-xs text-muted">{r.mustHave.map((item) => <li key={item}>• {item}</li>)}</ul>) },
    { key: "shouldHave", header: "建议具备", render: (r) => (<ul className="space-y-1 text-xs text-muted">{r.shouldHave.map((item) => <li key={item}>• {item}</li>)}</ul>) },
  ];
  const toolCallColumns: DataTableColumn<AgentToolCall>[] = [
    { key: "tool", header: "Tool", render: (r) => (<><div className="text-xs font-semibold text-foreground">{r.toolName}</div><div className="mt-1 text-label text-muted">{r.toolId}</div></>) },
    { key: "risk", header: "Risk", render: (r) => <Badge tone={r.riskLevel === "CRITICAL" ? "red" : r.riskLevel === "HIGH" ? "amber" : r.riskLevel === "MEDIUM" ? "blue" : "gray"}>{r.riskLevel}</Badge> },
    { key: "status", header: "Status", render: (r) => <span className="text-xs font-semibold text-muted">{r.status}</span> },
  ];
  const evidenceColumns: DataTableColumn<ProductEvidenceItem & { key: string }>[] = [
    { key: "metric", header: "Metric", render: (r) => <span className="text-xs font-semibold text-foreground">{r.metric}</span> },
    { key: "source", header: "Source", render: (r) => <span className="text-xs text-muted">{r.dataSource}</span> },
    { key: "value", header: "Value", render: (r) => <span className="text-xs text-muted">{JSON.stringify(r.value)}</span> },
  ];
  const stageColumns: DataTableColumn<ProductProjectDraft["stages"][number]>[] = [
    { key: "name", header: "阶段", render: (r) => <span className="text-xs font-semibold text-foreground">{r.name}</span> },
    { key: "goal", header: "目标", render: (r) => <span className="text-xs text-muted">{r.goal}</span> },
    { key: "owner", header: "负责人", render: (r) => <span className="text-xs text-muted">{r.owner}</span> },
  ];
  const metrics = useMemo(() => {
    const readiness = report?.scores.productReadiness ?? 0;
    const differentiation = report?.scores.differentiation ?? 0;
    const costFit = report?.scores.costFit ?? 0;
    const executionConfidence = report?.scores.executionConfidence ?? 0;

    return {
      readiness,
      differentiation,
      costFit,
      executionConfidence,
      tokenUsage: currentExecution?.tokenUsage ?? 0,
      toolCalls: currentExecution?.toolCallCount ?? 0,
    };
  }, [currentExecution?.tokenUsage, currentExecution?.toolCallCount, report]);

  return (
    <WorkbenchPageTemplate
      kpis={<section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Sparkles className="h-5 w-5 text-brand" />
            <div>
              <div className="text-lg font-black text-foreground">{metrics.readiness}</div>
              <div className="text-xs font-medium text-muted">产品就绪度</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-5 w-5 text-brand" />
            <div>
              <div className="text-lg font-black text-foreground">{metrics.differentiation}</div>
              <div className="text-xs font-medium text-muted">差异化</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <ShieldAlert className="h-5 w-5 text-brand" />
            <div>
              <div className="text-lg font-black text-foreground">{metrics.costFit}</div>
              <div className="text-xs font-medium text-muted">成本匹配</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <SquareKanban className="h-5 w-5 text-brand" />
            <div>
              <div className="text-lg font-black text-foreground">{metrics.executionConfidence}</div>
              <div className="text-xs font-medium text-muted">置信度</div>
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
      </section>}
      main={<>
      <section className="grid gap-[var(--gap-section)] xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader className="flex flex-col gap-2">
            <CardTitle className="text-section">产品简报</CardTitle>
            <p className="text-xs font-medium text-muted">把市场 Agent 的机会转成 PRD、成本目标和产品项目草案。</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <ChainHandoffNotice payload={chain.payload} error={chain.error} />
            {error ? <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{error}</div> : null}
            {selectedHandoff ? (
              <div className="rounded-md border border-brand/20 bg-brand/5 p-3">
                <div className="text-xs font-bold uppercase tracking-wide text-muted">市场交接</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{selectedHandoff.marketOpportunity?.productIdea ?? "已导入的市场机会"}</div>
                <div className="mt-2 text-xs text-muted">
                  {selectedHandoff.marketOpportunity?.opportunityScore ? `机会分数 ${selectedHandoff.marketOpportunity.opportunityScore}/100` : "机会已从市场 Agent 导入。"}
                </div>
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
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted">目标售价</span>
                <input value={targetPrice} onChange={(event) => setTargetPrice(event.target.value)} placeholder="$29.99" className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted">目标成本</span>
                <input value={targetCost} onChange={(event) => setTargetCost(event.target.value)} placeholder="$12.00" className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted">利润率 %</span>
                <input value={targetMargin} onChange={(event) => setTargetMargin(event.target.value)} className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand" />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted">产品约束</span>
              <textarea value={constraints} onChange={(event) => setConstraints(event.target.value)} className="min-h-20 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-brand" />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={runPlanning} disabled={!canCreate || running || loading} title={!canCreate ? "没有 Agent 创建权限" : undefined}>
                {running ? "运行中..." : "运行产品 Agent"}
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button type="button" onClick={createProject} disabled={!canCreate || projecting || !report} title={!canCreate ? "没有 Agent 创建权限" : undefined}>
                {projecting ? "创建中..." : "创建产品项目"}
                <SquareKanban className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" onClick={handoffToSupplierAgent} disabled={!report}>
                发送到供应 Agent
                <Sparkles className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" onClick={handoffToListingAgent} disabled={!report}>
                发送到刊登 Agent
                <Sparkles className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-section">审批</CardTitle>
              <p className="mt-1 text-xs font-medium text-muted">创建产品项目后，这里会出现待审批动作。</p>
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
                  <Button type="button" onClick={() => resolveApproval("APPROVED")} disabled={!canApprove || decisionBusy !== "" || currentApproval.status !== "REQUESTED"} title={!canApprove ? "没有 Agent 审批权限" : undefined}>
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
      </section>

      <section className="grid gap-[var(--gap-section)] xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-section">PRD</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {report ? (
              <>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">摘要</div>
                  <p className="mt-2 text-sm leading-6 text-foreground">{report.prd.summary}</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <MetricBox label="产品就绪度" value={report.scores.productReadiness} tone="blue" />
                  <MetricBox label="执行置信度" value={report.scores.executionConfidence} tone="green" />
                </div>
                <StandardDataTable
                  ariaLabel="PRD 必须具备与建议具备"
                  rows={[{ mustHave: report.prd.mustHave, shouldHave: report.prd.shouldHave }]}
                  getRowKey={() => "prd"}
                  columns={prdColumns}
                  empty="暂无 PRD。"
                />
              </>
            ) : (
              <div className="rounded-md border border-dashed border-border p-4 text-sm font-semibold text-muted">
                暂无 PRD。请先运行产品 Agent。
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-section">成本目标与项目</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {report ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <MetricBox label="目标售价" value={report.costTarget.targetRetailPrice} tone="blue" />
                  <MetricBox label="目标成本" value={report.costTarget.targetLandedCost} tone="amber" />
                </div>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">项目草案</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{report.projectDraft.projectName}</div>
                  <div className="mt-2 text-xs text-muted">{report.projectDraft.objective}</div>
                  <div className="mt-2 text-xs text-muted">下一步：{report.projectDraft.nextStep}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="gray">{report.marketplace}</Badge>
                  {report.category ? <Badge tone="gray">{report.category}</Badge> : null}
                  {report.sourceOpportunity?.productIdea ? <Badge tone="gray">{report.sourceOpportunity.productIdea}</Badge> : null}
                </div>
              </>
            ) : (
              <div className="rounded-md border border-dashed border-border p-4 text-sm font-semibold text-muted">
                暂无项目草案。
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-[var(--gap-section)] xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-section">竞品痛点</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {report?.competitorPainPoints.length ? (
              report.competitorPainPoints.map((item) => (
                <div key={item.painPoint} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-foreground">{item.painPoint}</div>
                    <Badge tone={riskTone(item.severity)}>{item.severity}</Badge>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-border p-4 text-sm font-semibold text-muted">
                暂无痛点。
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-section">差异化</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {report?.differentiation.length ? (
              report.differentiation.map((item) => (
                <div key={item.angle} className="rounded-md border border-border p-3">
                  <div className="text-sm font-semibold text-foreground">{item.angle}</div>
                  <div className="mt-1 text-xs text-muted">{item.benefit}</div>
                  <div className="mt-1 text-label text-muted">{item.rationale}</div>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-border p-4 text-sm font-semibold text-muted">
                暂无差异化策略。
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-[var(--gap-section)] xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-section">执行时间线</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {traces.length ? traces.map((trace) => <TimelineRow key={trace.id} trace={trace} />) : <EmptyState text="暂无执行轨迹。" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-section">工具调用</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {toolCalls.length ? (
              <StandardDataTable
                ariaLabel="产品 Agent 工具调用"
                rows={toolCalls}
                getRowKey={(toolCall) => toolCall.id}
                columns={toolCallColumns}
                empty="当前执行暂无工具调用。"
              />
            ) : (
              <EmptyState text="当前执行暂无工具调用。" />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-[var(--gap-section)] xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-section">证据</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {report?.evidence.length ? (
              <StandardDataTable
                ariaLabel="产品 Agent 证据"
                rows={report.evidence.map((item, index) => ({ ...item, key: `${item.metric}-${index}` }))}
                getRowKey={(item) => item.key}
                columns={evidenceColumns}
                empty="暂无可用证据。"
              />
            ) : (
              <EmptyState text="暂无可用证据。" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-section">市场交接</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedOpportunity ? (
              <>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">Opportunity</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{selectedOpportunity.productIdea}</div>
                  <div className="mt-2 text-xs text-muted">{selectedOpportunity.marketplace} / {selectedOpportunity.category}</div>
                </div>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">市场摘要</div>
                  <div className="mt-1 text-sm text-foreground">{selectedMarketReport?.summary ?? "No market report supplied."}</div>
                </div>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">Opportunity Score</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{selectedOpportunity.opportunityScore}/100</div>
                </div>
              </>
            ) : (
              <EmptyState text="No market handoff has been loaded yet." />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-[var(--gap-section)] xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-section">项目草案</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {report ? (
              <>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">Project Name</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{report.projectDraft.projectName}</div>
                </div>
                <StandardDataTable
                  ariaLabel="项目草案阶段"
                  rows={report.projectDraft.stages}
                  getRowKey={(stage) => stage.name}
                  columns={stageColumns}
                  empty="暂无阶段信息。"
                />
              </>
            ) : (
              <EmptyState text="暂无项目草案。" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-section">Memory</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {memoryItems.length ? (
              memoryItems.map((memory) => (
                <div key={memory.id} className="rounded-md border border-border p-3">
                  <div className="text-sm font-semibold text-foreground">{memory.summary}</div>
                  <div className="mt-1 text-label text-muted">{memory.scope} / {memory.scopeKey}</div>
                </div>
              ))
            ) : (
              <EmptyState text="No memory items yet." />
            )}
          </CardContent>
        </Card>
      </section>
      </>}
    />
  );
}

function MetricBox({ label, value, tone }: { label: string; value: string | number; tone: "blue" | "amber" | "green" | "red" }) {
  const toneClass =
    tone === "blue"
      ? "text-info-ink"
      : tone === "amber"
        ? "text-warning-ink"
        : tone === "green"
          ? "text-success-ink"
          : "text-danger-ink";

  return (
    <div className="rounded-md border border-border bg-surface-muted px-3 py-2">
      <div className="text-label font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function TimelineRow({ trace }: { trace: AgentTraceEvent }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-foreground">{trace.type}</div>
        <div className="text-label text-muted">{formatDate(trace.createdAt)}</div>
      </div>
      {trace.message ? <div className="mt-1 text-xs text-muted">{trace.message}</div> : null}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed border-border p-4 text-sm font-semibold text-muted">{text}</div>;
}
