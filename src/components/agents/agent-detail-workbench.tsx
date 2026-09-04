"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Database, FileText, RefreshCw, ShieldX } from "lucide-react";
import { PrefetchLink } from "@/components/app-shell/prefetch-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  AgentApproval,
  AgentCenterItem,
  AgentExecutionDetail,
  AgentExecutionSummary,
  AgentToolDefinition,
  JsonValue,
} from "@/lib/agent-platform";
import type { AgentRuntimeConfigStatus } from "@/lib/agent-platform/runtime-config";

type AgentDetailResponse = {
  agent: AgentCenterItem;
  tools: AgentToolDefinition[];
  executions: AgentExecutionSummary[];
  latestExecution: AgentExecutionDetail | null;
  runtimeConfig?: AgentRuntimeConfigStatus;
};

function formatDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatRiskTone(riskLevel?: string) {
  if (riskLevel === "CRITICAL") return "red";
  if (riskLevel === "HIGH") return "amber";
  if (riskLevel === "MEDIUM") return "blue";
  return "gray";
}

function sellerSpriteStatusLabel(status?: string) {
  if (status === "configured") return "SellerSprite 已就绪";
  if (status === "missing_credentials") return "SellerSprite 缺少密钥";
  return "SellerSprite 已停用";
}

function sellerSpriteStatusTone(status?: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (status === "configured") return "green";
  if (status === "missing_credentials") return "red";
  return "gray";
}

function statusTone(status?: string) {
  if (status === "COMPLETED") return "green";
  if (status === "WAITING_APPROVAL" || status === "RUNNING" || status === "WAITING_TOOL") return "amber";
  if (status === "FAILED" || status === "CANCELLED") return "red";
  return "gray";
}

function extractGoal(execution: AgentExecutionDetail | null, agent: AgentCenterItem | undefined) {
  const input = execution?.input;

  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    if (typeof record.naturalLanguageGoal === "string") return record.naturalLanguageGoal;
    if (typeof record.message === "string") return record.message;
  }

  return agent?.goals[0] ?? "-";
}

function extractEvidence(output: unknown): JsonValue[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) return [];
  const record = output as Record<string, unknown>;
  const direct = Array.isArray(record.evidence) ? record.evidence : [];
  const report = record.report && typeof record.report === "object" && !Array.isArray(record.report)
    ? (record.report as Record<string, unknown>)
    : {};
  const reportEvidence = Array.isArray(report.evidence) ? report.evidence : [];

  return [...direct, ...reportEvidence].slice(0, 8) as JsonValue[];
}

function confidencePercent(execution: AgentExecutionDetail | null) {
  const confidence = execution?.recommendation?.confidence ?? execution?.decision?.confidence;
  if (typeof confidence !== "number") return "-";

  return `${Math.round(confidence * 100)}%`;
}

function truncateJson(value: unknown) {
  const text = JSON.stringify(value ?? null, null, 2);

  return text.length > 900 ? `${text.slice(0, 900)}\n...` : text;
}

export function AgentDetailWorkbench({ agentId }: { agentId: string }) {
  const [data, setData] = useState<AgentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [approvalReason, setApprovalReason] = useState("");
  const [approvalBusyId, setApprovalBusyId] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    fetch(`/api/agents/${agentId}`)
      .then(async (response) => {
        const payload = (await response.json()) as AgentDetailResponse & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || "加载 Agent 失败。");
        }

        if (!cancelled) {
          setData(payload);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载 Agent 失败。");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, refreshToken]);

  const agent = data?.agent;
  const latestExecution = data?.latestExecution ?? null;
  const latestApproval = latestExecution?.approvals?.find((approval) => approval.status === "REQUESTED") ?? latestExecution?.approvals?.[0];
  const evidence = useMemo(() => extractEvidence(latestExecution?.output), [latestExecution?.output]);
  const toolNames = new Map((data?.tools ?? []).map((tool) => [tool.toolId, tool.name]));

  async function resolveApproval(approval: AgentApproval, decision: "APPROVED" | "REJECTED") {
    setApprovalBusyId(approval.id);
    setError("");

    try {
      const response = await fetch(`/api/agents/approvals/${approval.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          decision,
          reason: approvalReason,
        }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "处理审批失败。");
      }

      setApprovalReason("");
      setRefreshToken((current) => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "处理审批失败。");
    } finally {
      setApprovalBusyId("");
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <PrefetchLink href="/agents">
          <Button type="button" size="sm" variant="secondary">
            <ArrowLeft className="h-4 w-4" />
            Agent 中心
          </Button>
        </PrefetchLink>
        <Button type="button" size="sm" variant="ghost" onClick={() => setRefreshToken((current) => current + 1)} disabled={loading}>
          <RefreshCw className="h-4 w-4" />
          刷新
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>{agent?.name ?? agentId}</CardTitle>
            <p className="mt-1 max-w-3xl text-xs font-medium text-muted">{agent?.description ?? "-"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={agent?.enabled ? "green" : "gray"}>{agent?.enabled ? "就绪" : "已停用"}</Badge>
            <Badge tone="gray">{agent?.version ?? "-"}</Badge>
            <Badge tone={statusTone(latestExecution?.status)}>{latestExecution?.status ?? "暂无运行"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? <div className="rounded-md border border-danger/30 bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{error}</div> : null}

          <section className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-foreground">AI 模型</div>
                  <div className="mt-1 truncate text-xs font-semibold text-muted">
                    {data?.runtimeConfig?.ai.provider ?? "已保存配置"} · {data?.runtimeConfig?.ai.model ?? "未读取配置"}
                  </div>
                </div>
                <Badge tone={data?.runtimeConfig?.ai.enabled && data.runtimeConfig.ai.hasApiKey ? "green" : "amber"}>
                  {data?.runtimeConfig?.ai.enabled && data.runtimeConfig.ai.hasApiKey ? "已保存配置" : "待配置"}
                </Badge>
              </div>
            </div>
            <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-foreground">SellerSprite MCP</div>
                  <div className="mt-1 truncate text-xs font-semibold text-muted">
                    {data?.runtimeConfig?.integrations.sellerSprite.serverUrl || "未配置服务地址"}
                  </div>
                </div>
                <Badge tone={sellerSpriteStatusTone(data?.runtimeConfig?.integrations.sellerSprite.status)}>
                  {sellerSpriteStatusLabel(data?.runtimeConfig?.integrations.sellerSprite.status)}
                </Badge>
              </div>
            </div>
          </section>

          <section className="rounded-md border border-border bg-surface-muted p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-muted">目标</div>
            <div className="mt-2 text-base font-semibold text-foreground">{extractGoal(latestExecution, agent)}</div>
          </section>

          <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <Card>
              <CardHeader>
                <CardTitle>执行</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {latestExecution?.traces?.length ? (
                  latestExecution.traces.slice(0, 8).map((trace) => (
                    <div key={trace.id} className="flex items-start gap-3 rounded-md border border-border px-3 py-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">{trace.message ?? trace.type}</div>
                        <div className="mt-1 text-xs font-medium text-muted">{trace.type} · {formatDate(trace.createdAt)}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState text="暂无执行轨迹。" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>工具</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(data?.tools ?? []).length ? (
                  (data?.tools ?? []).map((tool) => (
                    <div key={tool.toolId} className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{tool.name}</div>
                        <div className="mt-1 text-xs font-medium text-muted">{tool.toolId}</div>
                      </div>
                      <Badge tone={formatRiskTone(tool.riskLevel)}>{tool.riskLevel}</Badge>
                    </div>
                  ))
                ) : (
                  <EmptyState text="暂无已注册工具。" />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <InfoPanel title="决策" value={latestExecution?.decision?.summary ?? "-"} />
            <InfoPanel title="建议" value={latestExecution?.recommendation?.summary ?? "-"} />
            <InfoPanel title="置信度" value={confidencePercent(latestExecution)} />
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle>证据</CardTitle>
              <Badge tone="gray">{evidence.length} 条</Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              {evidence.length ? evidence.map((item, index) => (
                <pre key={index} className="overflow-x-auto rounded-md border border-border bg-surface-muted p-3 text-xs leading-5 text-foreground">
                  {truncateJson(item)}
                </pre>
              )) : <EmptyState text="暂无证据记录。" />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>审批动作</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {latestApproval ? (
                <div className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-foreground">{latestApproval.recommendation.summary}</div>
                      <div className="mt-1 text-xs font-semibold text-muted">{latestApproval.action.type}</div>
                    </div>
                    <Badge tone={formatRiskTone(latestApproval.riskLevel)}>{latestApproval.status}</Badge>
                  </div>
                  {latestApproval.status === "REQUESTED" ? (
                    <div className="mt-3 space-y-2">
                      <textarea
                        value={approvalReason}
                        onChange={(event) => setApprovalReason(event.target.value)}
                        placeholder="审批理由"
                        className="min-h-20 w-full rounded-md border border-border px-3 py-2 text-xs outline-none focus:border-brand"
                      />
                      <div className="flex gap-2">
                        <Button type="button" size="sm" onClick={() => resolveApproval(latestApproval, "APPROVED")} disabled={Boolean(approvalBusyId)}>
                          <CheckCircle2 className="h-4 w-4" />
                          通过
                        </Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => resolveApproval(latestApproval, "REJECTED")} disabled={Boolean(approvalBusyId)}>
                          <ShieldX className="h-4 w-4" />
                          驳回
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyState text="暂无待处理动作。" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>执行历史</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(data?.executions ?? []).length ? (
                (data?.executions ?? []).map((execution) => (
                  <div key={execution.id} className="grid gap-2 rounded-md border border-border px-3 py-2 text-sm md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground">{execution.id}</div>
                      <div className="text-xs font-medium text-muted">{formatDate(execution.createdAt)}</div>
                    </div>
                    <Badge tone={statusTone(execution.status)}>{execution.status}</Badge>
                    <span className="text-xs font-semibold text-muted">{execution.tokenUsage} tokens</span>
                    <span className="text-xs font-semibold text-muted">{execution.toolCallCount} tools</span>
                  </div>
                ))
              ) : (
                <EmptyState text="暂无执行记录。" />
              )}
            </CardContent>
          </Card>

          {latestExecution?.toolCalls?.length ? (
            <Card>
              <CardHeader>
                <CardTitle>工具执行</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {latestExecution.toolCalls.map((toolCall) => (
                  <div key={toolCall.id} className="rounded-md border border-border px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-bold text-foreground">{toolNames.get(toolCall.toolId) ?? toolCall.toolId}</div>
                      <Badge tone={toolCall.status === "SUCCEEDED" ? "green" : toolCall.status === "FAILED" ? "red" : "amber"}>{toolCall.status}</Badge>
                    </div>
                    <div className="mt-1 text-xs font-medium text-muted">{toolCall.adapterId} · {toolCall.latencyMs ?? 0}ms</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoPanel({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
        {title === "证据" ? <Database className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        {title}
      </div>
      <div className="mt-2 text-sm font-semibold leading-6 text-foreground">{value}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface-muted px-3 py-6 text-center text-sm font-semibold text-muted">
      {text}
    </div>
  );
}
