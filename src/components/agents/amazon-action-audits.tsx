"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

export function amazonActionHeaders(json = false) {
  const headers = new Headers(json ? { "Content-Type": "application/json" } : {});
  try {
    const scope = JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}");
    headers.set("x-workspace-id", typeof scope.workspaceId === "string" ? scope.workspaceId : "default");
  } catch { headers.set("x-workspace-id", "default"); }
  return headers;
}
type ActionAudit = { id: string; status: string; createdAt: string; expiresAt: string | null; confirmedAt: string | null; idempotencyKey: string | null; preview: { approvalId?: string; plan?: { warnings?: string[] } } | null; oldValues: unknown; newValues: { execution?: { code?: string; message?: string; status?: string }; requested?: unknown } | null };
export function AmazonActionAudits({ refreshToken = 0, onChanged }: { refreshToken?: number; onChanged?: () => void }) {
  const [rows, setRows] = useState<ActionAudit[]>([]);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0); const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const changed = () => { generation.current++; setRows([]); setBusy(""); setMessage(""); setError(""); setReload((value) => value + 1); };
    window.addEventListener(workspaceScopeChangedEventName, changed);
    return () => window.removeEventListener(workspaceScopeChangedEventName, changed);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let active = true; const version = generation.current;
    setLoading(true);
    fetch("/api/agents/ppc/audits", { headers: amazonActionHeaders(), cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "审计读取失败。");
      if (active && version === generation.current) { setRows(result.rows ?? []); if (result.unavailable) setError("审计数据库尚未配置。"); }
    }).catch((err) => { if (active && version === generation.current) setError(err instanceof Error ? err.message : "审计读取失败。"); }).finally(() => { if (active && version === generation.current) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [reload, refreshToken]);
  async function act(row: ActionAudit, action: "APPROVED" | "REJECTED" | "apply") {
    if ((action !== "apply" && !row.preview?.approvalId) || !row.idempotencyKey) return;
    const version = generation.current; const headers = amazonActionHeaders(true);
    setBusy(row.id); setError(""); setMessage("");
    try {
      const response = await fetch(action === "apply" ? `/api/agents/ppc/audits/${encodeURIComponent(row.id)}/apply` : `/api/agents/approvals/${encodeURIComponent(row.preview!.approvalId!)}`, {
        method: "POST", headers, body: JSON.stringify(action === "apply" ? { idempotencyKey: row.idempotencyKey } : { decision: action, reason: "内部 ERP 人工复核出价预览" }),
      });
      const result = await response.json();
      if (version !== generation.current) return;
      if (!response.ok) throw new Error(result.error || result.execution?.message || "审计动作失败。");
      setMessage(action === "apply" ? result.execution?.message || "执行结果已记录。" : "人工审批已记录；尚未写入 Amazon。");
    } catch (err) { if (version === generation.current) setError(err instanceof Error ? err.message : "审计动作失败。"); }
    finally { if (version === generation.current) { setBusy(""); setReload((value) => value + 1); onChanged?.(); } }
  }
  return <Card>
    <CardHeader className="flex-row items-center justify-between"><CardTitle>Amazon 出价审计</CardTitle><Button variant="secondary" onClick={() => { setError(""); setReload((value) => value + 1); }}>刷新审计</Button></CardHeader>
    <CardContent className="space-y-3 text-sm">
      <p className="text-muted">仅 update_bid 预览。默认 dry_run；真实 HTTP 尚未实现，打开开关仍会明确失败。广告报表日期和实时旧出价需人工复核。</p>
      {loading && <p>读取审计中...</p>}
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!loading && !error && !rows.length && <p className="text-muted">当前工作区暂无审计。</p>}
      {rows.map((row) => <article key={row.id} className="space-y-2 rounded border border-border p-3">
        <div className="font-medium">{row.status} · {row.id}</div>
        <p className="text-xs text-muted">预览 {new Date(row.createdAt).toLocaleString("zh-CN")} · 到期 {row.expiresAt ? new Date(row.expiresAt).toLocaleString("zh-CN") : "未设置"} {row.confirmedAt ? "· 已人工确认" : ""}</p>
        {(row.preview?.plan?.warnings ?? []).map((warning, i) => <p key={i} className="text-xs text-muted">{warning}</p>)}
        {row.newValues?.execution && <p>{row.newValues?.execution.code} · {row.newValues?.execution.message}</p>}
        <details><summary className="cursor-pointer">查看 old/new 与执行结果</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ oldValues: row.oldValues, newValues: row.newValues }, null, 2)}</pre></details>
        <div className="flex gap-2">
          {row.status === "PREVIEW" && row.preview?.approvalId && row.idempotencyKey && row.expiresAt && !row.confirmedAt && new Date(row.expiresAt).getTime() > Date.now() && <>
            <Button disabled={!!busy} onClick={() => act(row, "APPROVED")}>确认预览</Button>
            <Button variant="secondary" disabled={!!busy} onClick={() => act(row, "REJECTED")}>拒绝预览</Button>
          </>}
          {row.confirmedAt && row.idempotencyKey && row.expiresAt && !row.newValues?.execution && ["PREVIEW", "CONFIRMED"].includes(row.status) && new Date(row.expiresAt).getTime() > Date.now() && <Button disabled={!!busy} onClick={() => act(row, "apply")}>{busy === row.id ? "处理中..." : "执行检查 / dry_run"}</Button>}
        </div>
      </article>)}
    </CardContent>
  </Card>;
}
