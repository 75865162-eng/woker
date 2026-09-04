"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, FileText, GitBranch, Play, RefreshCw, ShieldAlert } from "lucide-react";
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
  OrchestratorExecutionOutput,
  OrchestratorExecutionRequest,
  OrchestratorHandoff,
  OrchestratorStage,
} from "@/lib/agent-platform";

type OrchestratorAgentResponse = {
  agent: AgentCenterItem;
  tools: AgentToolDefinition[];
  executions: AgentExecutionSummary[];
  latestExecution: AgentExecutionDetail | null;
  memoryItems: AgentMemoryEntry[];
};

type OrchestratorExecutionResponse = {
  execution: Omit<AgentExecutionDetail, "approvals" | "toolCalls" | "traces" | "events">;
  executions: AgentExecutionSummary[];
  approvals: AgentApproval[];
  toolCalls: AgentToolCall[];
  traces: AgentTraceEvent[];
  events: unknown[];
};

const stageLabels: Record<string, string> = {
  market: "市场",
  product: "产品",
  supplier: "供应",
  listing: "刊登",
  launch: "上架",
  ppc: "PPC",
};

function formatDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function parseOutput(output: unknown): OrchestratorExecutionOutput | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const record = output as Partial<OrchestratorExecutionOutput>;

  if (record.plan && Array.isArray(record.handoffs)) {
    return record as OrchestratorExecutionOutput;
  }

  return null;
}

function statusTone(status?: string) {
  if (status === "completed" || status === "COMPLETED" || status === "ready") return "green";
  if (status === "waiting_approval" || status === "WAITING_APPROVAL") return "amber";
  if (status === "blocked_until_launch" || status === "FAILED") return "red";
  return "gray";
}

function truncateJson(value: unknown) {
  const serialized = JSON.stringify(value ?? null, null, 2);

  return serialized.length > 720 ? `${serialized.slice(0, 720)}\n...` : serialized;
}

export function OrchestratorAgentWorkbench() {
  const [data, setData] = useState<OrchestratorAgentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [goal, setGoal] = useState("从美国站市场机会开始，依次完成 Product、Supplier、Listing、Launch，并在批准后交给 PPC Agent");
  const [marketplace, setMarketplace] = useState("US");
  const [category, setCategory] = useState("Home & Kitchen");
  const [sku, setSku] = useState("");
  const [asin, setAsin] = useState("");
  const [launchApproved, setLaunchApproved] = useState(false);
  const [lastRun, setLastRun] = useState<OrchestratorExecutionResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    fetch("/api/agents/orchestrator")
      .then(async (response) => {
        const payload = (await response.json()) as OrchestratorAgentResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || "加载 Agent 编排器失败。");
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载 Agent 编排器失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const currentExecution = data?.latestExecution ?? null;
  const runOutput = useMemo(
    () => parseOutput(lastRun?.execution.output ?? currentExecution?.output),
    [currentExecution?.output, lastRun?.execution.output],
  );
  const toolCalls = lastRun?.toolCalls ?? currentExecution?.toolCalls ?? [];
  const traces = lastRun?.traces ?? currentExecution?.traces ?? [];
  const approvals = lastRun?.approvals ?? currentExecution?.approvals ?? [];
  const plan = runOutput?.plan ?? null;
  const handoffs = runOutput?.handoffs ?? [];

  async function refresh() {
    setRefreshToken((current) => current + 1);
  }

  async function runOrchestration() {
    setRunning(true);
    setError("");

    try {
      const requestBody: OrchestratorExecutionRequest = {
        naturalLanguageGoal: goal,
        marketplace,
        category,
        sku: sku.trim() || undefined,
        asin: asin.trim() || undefined,
        launchApproved,
        context: {
          sku: sku.trim() || undefined,
          asin: asin.trim() || undefined,
          currentData: {
            goal,
            marketplace,
            category,
            sku: sku.trim() || undefined,
            asin: asin.trim() || undefined,
            launchApproved,
          },
        },
      };
      const response = await fetch("/api/agents/orchestrator/executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const payload = (await response.json()) as OrchestratorExecutionResponse & { error?: string };

      if (!response.ok) throw new Error(payload.error || "运行 Agent 编排器失败。");

      setLastRun(payload);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "运行 Agent 编排器失败。");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>运行编排</CardTitle>
            <Button type="button" size="sm" variant="ghost" onClick={refresh} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {error ? <div className="rounded-md border border-danger/30 bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{error}</div> : null}
            <label className="block text-xs font-bold text-muted">
              目标
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                className="mt-1 min-h-28 w-full rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground outline-none ring-brand focus:ring-2"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-bold text-muted">
                站点
                <input
                  value={marketplace}
                  onChange={(event) => setMarketplace(event.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground outline-none ring-brand focus:ring-2"
                />
              </label>
              <label className="block text-xs font-bold text-muted">
                类目
                <input
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground outline-none ring-brand focus:ring-2"
                />
              </label>
              <label className="block text-xs font-bold text-muted">
                SKU
                <input
                  value={sku}
                  onChange={(event) => setSku(event.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground outline-none ring-brand focus:ring-2"
                />
              </label>
              <label className="block text-xs font-bold text-muted">
                ASIN
                <input
                  value={asin}
                  onChange={(event) => setAsin(event.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground outline-none ring-brand focus:ring-2"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm font-semibold text-foreground">
              <input
                type="checkbox"
                checked={launchApproved}
                onChange={(event) => setLaunchApproved(event.target.checked)}
                className="h-4 w-4 accent-brand"
              />
              已批准上架
            </label>
            <Button type="button" className="w-full" onClick={runOrchestration} disabled={running || loading}>
              {running ? <Clock3 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? "运行中..." : "运行编排"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agent 链接</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {["market", "product", "supplier", "listing", "ppc"].map((agentId) => (
              <Link key={agentId} href={`/agents/${agentId}`} prefetch={false}>
                <Button type="button" size="sm" variant="secondary" className="w-full justify-between">
                  {stageLabels[agentId]}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={<GitBranch className="h-5 w-5 text-brand" />} value={plan?.stages.length ?? 0} label="阶段" />
          <MetricCard icon={<FileText className="h-5 w-5 text-brand" />} value={handoffs.length} label="交接" />
          <MetricCard icon={<ShieldAlert className="h-5 w-5 text-brand" />} value={approvals.length} label="审批" />
          <MetricCard icon={<CheckCircle2 className="h-5 w-5 text-brand" />} value={toolCalls.length} label="工具调用" />
        </section>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle>商业链路</CardTitle>
                <p className="mt-1 text-xs font-medium text-muted">{plan?.planId ?? "运行编排器以生成阶段计划。"}</p>
              </div>
              {runOutput ? <Badge tone={statusTone(lastRun?.execution.status ?? currentExecution?.status)}>{lastRun?.execution.status ?? currentExecution?.status ?? "READY"}</Badge> : null}
            </div>
          </CardHeader>
          <CardContent>
            {plan ? (
              <div className="space-y-3">
                <div className="overflow-x-auto">
                  <div className="flex min-w-[760px] items-center gap-2">
                    {plan.stages.map((stage, index) => (
                      <StageNode key={stage.id} stage={stage} last={index === plan.stages.length - 1} />
                    ))}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-surface-muted p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">下一步动作</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{runOutput?.nextAction}</div>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-surface-muted px-3 py-8 text-center text-sm font-semibold text-muted">
                暂无编排计划。
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>交接</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {handoffs.length ? handoffs.map((handoff) => <HandoffRow key={`${handoff.from}-${handoff.to}`} handoff={handoff} />) : (
              <div className="rounded-md border border-dashed border-border bg-surface-muted px-3 py-6 text-center text-sm font-semibold text-muted">
                暂无交接内容。
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>执行轨迹</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[420px] space-y-2 overflow-y-auto">
              {traces.length ? traces.map((trace) => (
                <div key={trace.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone="gray">{trace.type}</Badge>
                    <span className="text-[11px] font-semibold text-muted">{formatDate(trace.createdAt)}</span>
                  </div>
                  <div className="mt-2 text-sm font-semibold text-foreground">{trace.message}</div>
                </div>
              )) : <EmptyLine text="暂无轨迹事件。" />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>工具调用</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[420px] space-y-2 overflow-y-auto">
              {toolCalls.length ? toolCalls.map((toolCall) => (
                <div key={toolCall.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-bold text-foreground">{toolCall.toolId}</div>
                    <Badge tone={statusTone(toolCall.status)}>{toolCall.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-muted">{toolCall.adapterId} · {toolCall.riskLevel}</div>
                </div>
              )) : <EmptyLine text="暂无工具调用。" />}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon, value, label }: { icon: ReactNode; value: number | string; label: string }) {
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

function StageNode({ stage, last }: { stage: OrchestratorStage; last: boolean }) {
  return (
    <>
      <div className="min-h-[128px] w-[132px] rounded-md border border-border bg-white p-3">
        <div className="text-sm font-black text-foreground">{stageLabels[stage.id]}</div>
        <div className="mt-2">
          <Badge tone={statusTone(stage.status)}>{stage.status}</Badge>
        </div>
        <div className="mt-2 line-clamp-3 text-xs font-medium leading-5 text-muted">{stage.objective}</div>
      </div>
      {!last ? <ArrowRight className="h-5 w-5 shrink-0 text-muted" /> : null}
    </>
  );
}

function HandoffRow({ handoff }: { handoff: OrchestratorHandoff }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-foreground">{handoff.summary}</div>
        <div className="flex items-center gap-2">
        {handoff.requiredApproval ? <Badge tone="amber">审批</Badge> : null}
          {handoff.route ? (
            <Link href={handoff.route} prefetch={false}>
              <Button type="button" size="sm" variant="secondary">
                打开
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          ) : null}
        </div>
      </div>
      <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-surface-muted p-3 text-xs font-medium leading-5 text-foreground">
        {truncateJson(handoff.payload)}
      </pre>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface-muted px-3 py-6 text-center text-sm font-semibold text-muted">
      {text}
    </div>
  );
}
