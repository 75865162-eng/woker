"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { normalizeWorkspaceScope } from "@/lib/workspace/scope";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resourceLabels, type Schedule } from "@/components/sellfox/workbench-types";

type Health = { configured: boolean; queueEnabled: boolean; worker: { online: boolean; lastSeenAt: string | null }; schedules: Schedule[] };
function date(value?: string | null) { return value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—"; }

export function SellfoxHealthPanel() {
  const user = useAppShellUser();
  const allowed = roleCanPerformAction(user?.userRole, "sellfox", "view", user?.rolePermissions);
  const [state, setState] = useState<{ data: Health | null; error: string }>({ data: null, error: "" });
  useEffect(() => {
    if (!allowed) return;
    let controller: AbortController | undefined;
    let generation = 0;
    async function load() {
      controller?.abort(); controller = new AbortController();
      const signal = controller.signal; const epoch = ++generation;
      setState({ data: null, error: "" });
      try {
        let stored: unknown;
        try { stored = JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}"); } catch { stored = {}; }
        const scope = normalizeWorkspaceScope(stored as Parameters<typeof normalizeWorkspaceScope>[0]);
        const response = await fetch("/api/sellfox/schedules", { headers: { "x-workspace-id": scope.workspaceId }, cache: "no-store", signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "赛狐运行状态读取失败。");
        if (!signal.aborted && epoch === generation) setState({ data, error: "" });
      } catch (error) {
        if (!signal.aborted && epoch === generation) setState({ data: null, error: error instanceof Error ? error.message : "赛狐运行状态读取失败。" });
      }
    }
    void load();
    const refresh = () => { void load(); };
    const timer = setInterval(refresh, 30_000);
    window.addEventListener(workspaceScopeChangedEventName, refresh);
    return () => { ++generation; controller?.abort(); clearInterval(timer); window.removeEventListener(workspaceScopeChangedEventName, refresh); };
  }, [allowed]);
  if (!allowed) return null;
  const data = state.data;
  return <Card><CardHeader><CardTitle>赛狐同步运行状态</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
    {state.error ? <p role="alert" className="text-red-600">{state.error}</p> : data ? <>
      <p>凭据：{data.configured ? "configured" : "未配置"} · 队列：{data.queueEnabled ? "已启用" : "未启用"} · Worker：{data.worker.online ? "在线" : "离线或心跳超时"}</p>
      <p className="text-xs text-muted">最近心跳：{date(data.worker.lastSeenAt)} · 计划时间均为北京时间；实际执行受队列顺序影响。</p>
      <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>数据域</th><th>计划</th><th>最近入队</th><th>下次计划</th></tr></thead><tbody>{data.schedules.map((item) => <tr key={item.resource} className="border-t border-border"><td className="py-2">{resourceLabels[item.resource] ?? item.resource}</td><td>{item.enabled ? "已启用" : "已关闭"}</td><td>{date(item.lastEnqueuedAt)}</td><td>{date(item.nextRunAt)}</td></tr>)}</tbody></table></div>
    </> : <p className="text-muted">读取运行状态…</p>}
    <Link href="/sellfox?domain=runs" className="text-brand underline">查看赛狐数据与同步日志</Link>
  </CardContent></Card>;
}
