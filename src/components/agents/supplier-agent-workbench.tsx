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
import { supplierHandoffStorageKey, type SupplierAnalysisReport, type SupplierExecutionOutput } from "@/lib/agent-platform/supplier";

type SupplierAgentResponse = {
  agent: AgentCenterItem;
  tools: AgentToolDefinition[];
  executions: AgentExecutionSummary[];
  latestExecution: AgentExecutionDetail | null;
  memoryItems: AgentMemoryEntry[];
};

type SupplierExecutionResponse = {
  execution: Omit<AgentExecutionDetail, "approvals" | "toolCalls" | "traces" | "events">;
  executions: AgentExecutionSummary[];
  approvals: AgentApproval[];
  toolCalls: AgentToolCall[];
  traces: AgentTraceEvent[];
  events: unknown[];
};

type SupplierProjectResponse = {
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

function parseSupplierOutput(output: unknown): SupplierExecutionOutput | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  const report = record.report as SupplierAnalysisReport | undefined;
  if (report && typeof report === "object") {
    return {
      report,
      evidence: (record.evidence as SupplierExecutionOutput["evidence"]) ?? report.evidence ?? [],
      memoryItems: [],
    };
  }
  return null;
}

function getCurrentApproval(execution?: AgentExecutionDetail | null, fallback?: AgentApproval | null) {
  const requested = execution?.approvals?.find((approval) => approval.status === "REQUESTED");
  return requested ?? execution?.approvals?.[0] ?? fallback ?? null;
}

export function SupplierAgentWorkbench() {
  const [data, setData] = useState<SupplierAgentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [running, setRunning] = useState(false);
  const [projecting, setProjecting] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState<"APPROVED" | "REJECTED" | "">("");
  const [goal, setGoal] = useState("把产品计划转成供应商推荐和 RFQ");
  const [marketplace, setMarketplace] = useState("US");
  const [category, setCategory] = useState("");
  const [selectedHandoff, setSelectedHandoff] = useState<Record<string, unknown> | null>(null);
  const [pendingApproval, setPendingApproval] = useState<AgentApproval | null>(null);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(supplierHandoffStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      setSelectedHandoff(parsed);
      if (typeof parsed.goal === "string") setGoal(parsed.goal);
      if (typeof parsed.marketplace === "string") setMarketplace(parsed.marketplace);
      if (typeof parsed.category === "string") setCategory(parsed.category);
      window.sessionStorage.removeItem(supplierHandoffStorageKey);
    } catch {
      window.sessionStorage.removeItem(supplierHandoffStorageKey);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    fetch("/api/agents/supplier")
      .then(async (response) => {
        const payload = (await response.json()) as SupplierAgentResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || "加载供应 Agent 失败。");
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载供应 Agent 失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const currentExecution = data?.latestExecution ?? null;
  const supplierExecution = useMemo(() => parseSupplierOutput(currentExecution?.output), [currentExecution?.output]);
  const report = supplierExecution?.report ?? null;
  const currentApproval = getCurrentApproval(currentExecution, pendingApproval);
  const toolCalls = currentExecution?.toolCalls ?? [];
  const traces = currentExecution?.traces ?? [];
  const memoryItems = data?.memoryItems ?? [];

  async function refresh() {
    setRefreshToken((current) => current + 1);
  }

  async function runPlanning() {
    setRunning(true);
    setError("");
    setPendingApproval(null);

    try {
      const response = await fetch("/api/agents/supplier/executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          naturalLanguageGoal: goal,
          marketplace,
          category: category || undefined,
          productHandoff: selectedHandoff ?? undefined,
          context: {
            currentData: {
              goal,
              marketplace,
              category,
              productHandoff: selectedHandoff,
            },
          },
        }),
      });
      const payload = (await response.json()) as SupplierExecutionResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "运行供应 Agent 失败。");

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
      setError(err instanceof Error ? err.message : "运行供应 Agent 失败。");
    } finally {
      setRunning(false);
    }
  }

  async function createProject() {
    if (!report) return;

    setProjecting(true);
    setError("");

    try {
      const response = await fetch("/api/agents/supplier/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report,
          prd: selectedHandoff && typeof selectedHandoff === "object" && "prd" in selectedHandoff ? selectedHandoff.prd : undefined,
          marketplace: report.marketplace,
          context: {
            currentData: {
              marketplace: report.marketplace,
              category: report.category,
              projectName: report.supplierProjectDraft.projectName,
            },
          },
        }),
      });
      const payload = (await response.json()) as SupplierProjectResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "创建供应项目审批失败。");

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
      setError(err instanceof Error ? err.message : "创建供应项目审批失败。");
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
          reason: decision === "APPROVED" ? "已由供应 Agent 审批通过。" : "已由供应 Agent 审批驳回。",
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

  const reportSummary = report?.summary ?? "-";

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="供应商" value={report?.supplierRecommendations.length ?? 0} icon={<Sparkles className="h-5 w-5 text-brand" />} />
        <MetricCard label="报价" value={report?.quotationAnalysis.length ?? 0} icon={<FileText className="h-5 w-5 text-brand" />} />
        <MetricCard label="工具调用" value={currentExecution?.toolCallCount ?? 0} icon={<Clock3 className="h-5 w-5 text-brand" />} />
        <MetricCard label="记忆条目" value={memoryItems.length} icon={<SquareKanban className="h-5 w-5 text-brand" />} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader className="flex flex-col gap-2">
            <CardTitle>供应简报</CardTitle>
            <p className="text-xs font-medium text-muted">把产品 Agent 的计划转成供应商推荐、报价分析和 RFQ 草稿。</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {error ? <div className="rounded-md border border-danger/30 bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{error}</div> : null}
            {selectedHandoff ? (
              <div className="rounded-md border border-brand/20 bg-brand/5 p-3">
                <div className="text-xs font-bold uppercase tracking-wide text-muted">产品交接</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{typeof selectedHandoff?.prd === "object" && selectedHandoff?.prd && "summary" in selectedHandoff.prd ? String((selectedHandoff.prd as Record<string, unknown>).summary ?? "已导入的 PRD") : "已导入的 PRD"}</div>
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
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={runPlanning} disabled={running || loading}>
                {running ? "运行中..." : "运行供应 Agent"}
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button type="button" onClick={createProject} disabled={projecting || !report}>
                {projecting ? "创建中..." : "创建供应项目"}
                <SquareKanban className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>审批</CardTitle>
              <p className="mt-1 text-xs font-medium text-muted">创建供应项目后，这里会出现待审批动作。</p>
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
          <CardHeader>
            <CardTitle>供应商推荐</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {report?.supplierRecommendations.length ? report.supplierRecommendations.map((supplier) => (
              <div key={supplier.supplierId} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-foreground">{supplier.supplierName}</div>
                  <Badge tone="blue">{Math.round(supplier.confidence * 100)}%</Badge>
                </div>
                <div className="mt-1 text-xs text-muted">{supplier.summary}</div>
              </div>
            )) : <EmptyState text="暂无供应商推荐。" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>RFQ 草稿</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {report ? (
              <>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">主题</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{report.rfqDraft.subject}</div>
                </div>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">问题</div>
                  <ul className="mt-2 space-y-1 text-xs text-muted">
                    {report.rfqDraft.questions.map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                </div>
              </>
            ) : <EmptyState text="暂无 RFQ 草稿。" />}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>报价分析</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {report?.quotationAnalysis.length ? report.quotationAnalysis.map((item) => (
              <div key={item.supplierId} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-foreground">{item.supplierName}</div>
                  <Badge tone="gray">{item.score}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted">{item.moq} / {item.unitPrice} / {item.leadTime}</div>
              </div>
            )) : <EmptyState text="暂无报价分析。" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>项目草案</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {report ? (
              <>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">项目</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{report.supplierProjectDraft.projectName}</div>
                </div>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="bg-surface-muted text-xs font-bold text-muted">
                      <tr>
                        <th className="px-3 py-2 text-left">阶段</th>
                        <th className="px-3 py-2 text-left">目标</th>
                        <th className="px-3 py-2 text-left">负责人</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-white">
                      {report.supplierProjectDraft.stages.map((stage) => (
                        <tr key={stage.name}>
                          <td className="px-3 py-2 text-xs font-semibold text-foreground">{stage.name}</td>
                          <td className="px-3 py-2 text-xs text-muted">{stage.goal}</td>
                          <td className="px-3 py-2 text-xs text-muted">{stage.owner}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">摘要</div>
                  <div className="mt-1 text-sm text-foreground">{reportSummary}</div>
                </div>
              </>
            ) : <EmptyState text="暂无项目草案。" />}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>执行时间线</CardTitle>
          </CardHeader>
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

        <Card>
          <CardHeader>
            <CardTitle>工具调用</CardTitle>
          </CardHeader>
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
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>证据</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {report?.evidence.length ? report.evidence.map((item, index) => (
              <div key={`${item.metric}-${index}`} className="rounded-md border border-border p-3">
                <div className="text-sm font-semibold text-foreground">{item.metric}</div>
                <div className="mt-1 text-xs text-muted">{item.dataSource}</div>
              </div>
            )) : <EmptyState text="暂无证据。" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>记忆</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {memoryItems.length ? memoryItems.map((memory) => (
              <div key={memory.id} className="rounded-md border border-border p-3">
                <div className="text-sm font-semibold text-foreground">{memory.summary}</div>
                <div className="mt-1 text-[11px] text-muted">{memory.scope} / {memory.scopeKey}</div>
              </div>
            )) : <EmptyState text="暂无记忆条目。" />}
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
