"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bot, Circle, GitBranch, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentCenterItem } from "@/lib/agent-platform";
import type { AgentRuntimeConfigStatus } from "@/lib/agent-platform/runtime-config";

type AgentCenterResponse = {
  agents: AgentCenterItem[];
  runtimeConfig?: AgentRuntimeConfigStatus;
};

type AgentTaskView = {
  agent: AgentCenterItem;
  tone: "blue" | "amber" | "red" | "gray";
  title: string;
  summary: string;
};

const workflowAgentIds = ["market", "product", "supplier", "listing", "ppc"];

const agentDisplayName: Record<string, string> = {
  market: "市场 Agent",
  product: "产品 Agent",
  supplier: "供应 Agent",
  listing: "刊登 Agent",
  ppc: "PPC 广告 Agent",
  orchestrator: "Agent 编排器",
};

const idleTaskCopy: Record<string, string> = {
  market: "等待市场研究目标",
  product: "等待市场 Agent 机会输入",
  supplier: "等待 PRD 和成本目标",
  listing: "等待产品规格和关键词",
  ppc: "等待 Launch 审批和广告数据",
};

function formatDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function statusLabel(agent: AgentCenterItem) {
  if (!agent.enabled) return "已停用";
  return "就绪";
}

function statusTone(agent: AgentCenterItem): "green" | "amber" | "red" | "blue" | "gray" {
  if (!agent.enabled) return "gray";
  return "green";
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

function taskForAgent(agent: AgentCenterItem): AgentTaskView | null {
  if (!agent.lastStatus || agent.lastStatus === "COMPLETED" || agent.lastStatus === "CANCELLED") return null;

  if (agent.lastStatus === "RUNNING" || agent.lastStatus === "WAITING_TOOL") {
    return {
      agent,
      tone: "blue",
      title: agentDisplayName[agent.id] ?? agent.name,
      summary: `正在执行 ${agentDisplayName[agent.id] ?? agent.name} 工作流`,
    };
  }

  if (agent.lastStatus === "WAITING_APPROVAL") {
    return {
      agent,
      tone: "amber",
      title: agentDisplayName[agent.id] ?? agent.name,
      summary: "等待人工审批",
    };
  }

  if (agent.lastStatus === "FAILED") {
    return {
      agent,
      tone: "red",
      title: agentDisplayName[agent.id] ?? agent.name,
      summary: "执行失败，等待复查轨迹和错误信息",
    };
  }

  return null;
}

export function AgentCenterWorkbench() {
  const [data, setData] = useState<AgentCenterResponse>({ agents: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    fetch("/api/agents")
      .then(async (response) => {
        const payload = (await response.json()) as AgentCenterResponse & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || "加载 Agent 失败。");
        }

        if (!cancelled) {
          setData({
            agents: Array.isArray(payload.agents) ? payload.agents : [],
            runtimeConfig: payload.runtimeConfig,
          });
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
  }, [refreshToken]);

  const agentsById = useMemo(() => new Map(data.agents.map((agent) => [agent.id, agent])), [data.agents]);
  const workflowAgents = workflowAgentIds
    .map((agentId) => agentsById.get(agentId))
    .filter((agent): agent is AgentCenterItem => Boolean(agent));
  const orchestrator = agentsById.get("orchestrator");
  const activeTasks = workflowAgents
    .filter((agent) => Boolean(agent.lastExecutionAt))
    .map(taskForAgent)
    .filter((task): task is AgentTaskView => Boolean(task));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>AI Agent 中心</CardTitle>
            <p className="mt-1 text-xs font-medium text-muted">市场 → 产品 → 供应 → 刊登 → Launch → PPC</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {orchestrator ? (
              <Link href="/agents/orchestrator" prefetch={false}>
                <Button type="button" size="sm" variant="secondary">
                  <GitBranch className="h-4 w-4" />
                  编排器
                </Button>
              </Link>
            ) : null}
              <Button type="button" size="sm" variant="ghost" onClick={() => setRefreshToken((current) => current + 1)} disabled={loading}>
                <RefreshCw className="h-4 w-4" />
              刷新
              </Button>
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
                    {data.runtimeConfig?.ai.provider ?? "已保存配置"} · {data.runtimeConfig?.ai.model ?? "未读取配置"}
                  </div>
                </div>
                <Badge tone={data.runtimeConfig?.ai.enabled && data.runtimeConfig.ai.hasApiKey ? "green" : "amber"}>
                  {data.runtimeConfig?.ai.enabled && data.runtimeConfig.ai.hasApiKey ? "已保存配置" : "待配置"}
                </Badge>
              </div>
            </div>
            <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-foreground">SellerSprite MCP</div>
                  <div className="mt-1 truncate text-xs font-semibold text-muted">
                    {data.runtimeConfig?.integrations.sellerSprite.serverUrl || "未配置服务地址"}
                  </div>
                </div>
                <Badge tone={sellerSpriteStatusTone(data.runtimeConfig?.integrations.sellerSprite.status)}>
                  {sellerSpriteStatusLabel(data.runtimeConfig?.integrations.sellerSprite.status)}
                </Badge>
              </div>
            </div>
          </section>

          <section className="rounded-md border border-border bg-white">
            {loading ? (
              <div className="px-4 py-10 text-center text-sm font-semibold text-muted">加载中...</div>
            ) : workflowAgents.length ? (
              <div className="divide-y divide-border">
                {workflowAgents.map((agent) => (
                  <Link
                    key={agent.id}
                    href={`/agents/${agent.id}`}
                    prefetch={false}
                    className="flex items-center justify-between gap-3 px-4 py-4 transition-colors hover:bg-surface-muted"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Bot className="h-5 w-5 shrink-0 text-brand" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-foreground">{agentDisplayName[agent.id] ?? agent.name}</div>
                        <div className="mt-1 truncate text-xs font-semibold text-muted">{idleTaskCopy[agent.id] ?? agent.description}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge tone={statusTone(agent)}>{statusLabel(agent)}</Badge>
                      <ArrowRight className="h-4 w-4 text-muted" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="px-4 py-10 text-center text-sm font-semibold text-muted">暂无已注册的工作流 Agent。</div>
            )}
          </section>

          <section className="rounded-md border border-border bg-white">
            <div className="border-b border-border px-4 py-3">
              <div className="text-sm font-black text-foreground">当前任务</div>
            </div>
            <div className="divide-y divide-border">
              {activeTasks.length ? (
                activeTasks.map((task) => (
                  <Link
                    key={`${task.agent.id}-${task.agent.lastExecutionId ?? task.agent.lastStatus}`}
                    href={`/agents/${task.agent.id}`}
                    prefetch={false}
                    className="flex items-start justify-between gap-3 px-4 py-4 transition-colors hover:bg-surface-muted"
                  >
                    <div className="flex min-w-0 gap-3">
                      <Circle className={`mt-1 h-3 w-3 shrink-0 fill-current ${task.tone === "blue" ? "text-blue-500" : task.tone === "amber" ? "text-amber-500" : task.tone === "red" ? "text-red-500" : "text-muted"}`} />
                      <div className="min-w-0">
                        <div className="text-sm font-black text-foreground">{task.title}</div>
                        <div className="mt-1 text-sm font-semibold text-muted">{task.summary}</div>
                        <div className="mt-1 text-xs font-medium text-muted">{formatDate(task.agent.lastExecutionAt)}</div>
                      </div>
                    </div>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted" />
                  </Link>
                ))
              ) : (
                <div className="px-4 py-8 text-sm font-semibold text-muted">当前没有运行中或待审批任务。</div>
              )}
            </div>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
