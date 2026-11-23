"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { normalizeWorkspaceScope } from "@/lib/workspace/scope";

type Proposal = {
  id: string; storeId: string; asin: string; msku: string | null; kind: string; action: string;
  entityType: string; externalId: string; label: string | null; proposed: { bidMultiplier?: number; state?: string };
  basis: { clicks?: number; cost?: number; currency?: string | null; adOrders?: number; acosPct?: number | null; spend7d?: number | null; coverDays?: number | null; onHand?: number | null };
  expectedImpact: string | null; status: string; decisionReason: string | null; executionNote?: string | null; createdAt: string;
  store: { name: string; marketplace: string; country: string } | null;
};
type Response = { proposals: Proposal[]; counts: Record<string, number>; writeExecution: { enabled: boolean; note: string } };

const kindMeta: Record<string, { label: string; className: string }> = {
  STOCKOUT_RISK: { label: "断货风险", className: "border-danger/30 bg-danger-soft text-danger-ink" },
  NO_CONVERSION: { label: "0转化止血", className: "border-warning-ink/30 bg-warning-soft text-warning-ink" },
  HIGH_ACOS: { label: "高ACOS", className: "border-warning-ink/30 bg-warning-soft text-warning-ink" },
  HIGH_POTENTIAL: { label: "高潜力加码", className: "border-success/30 bg-success-soft text-success-ink" },
};
const actionText: Record<string, string> = { LOWER_BID: "降价", RAISE_BID: "加价", PAUSE: "暂停" };
const statusText: Record<string, string> = { PENDING: "待审批", APPROVED: "已批准", REJECTED: "已驳回", EXECUTED: "已执行", FAILED: "执行失败" };

export function SellfoxAdsProposals() {
  const shellUser = useAppShellUser();
  const canEdit = roleCanPerformAction(shellUser?.userRole, "sellfox", "edit", shellUser?.rolePermissions);
  const scope = useMemo(() => normalizeWorkspaceScope(), []);
  const [data, setData] = useState<Response | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedApproved, setSelectedApproved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/sellfox/ads-proposals", { headers: { "x-workspace-id": scope.workspaceId } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "加载失败");
      setData(body);
    } catch (e) { setError(e instanceof Error ? e.message : "加载失败"); }
  }, [scope.workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const act = async (action: string, ids?: string[]) => {
    setBusy(action);
    setNotice("");
    setError("");
    try {
      const res = await fetch("/api/sellfox/ads-proposals", {
        method: "POST",
        headers: { "content-type": "application/json", "x-workspace-id": scope.workspaceId },
        body: JSON.stringify({ action, ids }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "操作失败");
      if (action === "generate") setNotice(`已生成方案：新 ${body.created} 条、更新 ${body.updated} 条（候选 ${body.generated}）`);
      if (action === "decide") { setNotice(`已完成业务审批 ${body.approved} 条；审批不会写回 Amazon Ads，当前尚未创建 Ads 变更草稿。`); setSelected(new Set()); }
      if (action === "reject") { setNotice(`已驳回 ${body.rejected} 条`); setSelected(new Set()); }
      if (action === "execute") {
        const failed = body.items?.filter((item: { status: string }) => item.status === "FAILED") ?? [];
        const codes = [...new Set(failed.map((item: { code: string }) => item.code))].join(", ");
        setNotice(`写回未执行（${codes || "无可执行项"}）：真实应用 ${body.applied ?? 0} 条。${body.capability?.note ?? ""}`);
        setSelectedApproved(new Set());
      }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(""); }
  };

  const pending = data?.proposals.filter(p => p.status === "PENDING") ?? [];
  const toggle = (id: string) => setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleApproved = (id: string) => setSelectedApproved(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return (
    <section className="border border-[var(--sf-line)] bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--sf-line)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[var(--sf-blue)]" />
          <h2 className="text-sm font-medium">库存 × 广告优化方案</h2>
          <span className="text-xs text-muted">
            {data ? `待审批 ${data.counts.PENDING ?? 0} · 已批准 ${data.counts.APPROVED ?? 0} · 已执行 ${data.counts.EXECUTED ?? 0}` : "加载中…"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {canEdit ? (
            <button type="button" onClick={() => void act("generate")} disabled={busy !== ""}
              className="inline-flex h-7 items-center gap-1 border border-[var(--sf-line)] px-2 text-xs hover:border-[var(--sf-blue)] hover:text-[var(--sf-blue)] disabled:opacity-50">
              {busy === "generate" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} 重新生成方案
            </button>
          ) : null}
        </div>
      </header>
      {notice ? <div className="border-b border-success/30 bg-success-soft px-3 py-1.5 text-xs text-success-ink">{notice}</div> : null}
      {error ? <div role="alert" className="border-b border-danger/30 bg-danger-soft px-3 py-1.5 text-xs text-danger-ink">{error}</div> : null}
      <div className="border-b border-warning-ink/30 bg-warning-soft px-3 py-1.5 text-xs text-warning-ink">
        {data?.writeExecution.enabled ? "环境开关已打开，但不代表写回链路已验证或可用；本页批准不会触发 Ads 写入。" : data?.writeExecution.note ?? "Sellfox 方案仅供业务审核，不会直接写入 Amazon Ads。"}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-surface-muted text-left text-muted">
            <tr>
              <th className="w-8 px-2 py-1.5"><input type="checkbox" aria-label="全选待审批" checked={pending.length > 0 && pending.every(p => selected.has(p.id))} onChange={e => setSelected(e.target.checked ? new Set(pending.map(p => p.id)) : new Set())} /></th>
              <th className="w-8 px-2 py-1.5" title="选择已批准方案进行受闸门写回">执行</th>
              <th className="px-2 py-1.5">类型</th>
              <th className="px-2 py-1.5">建议动作</th>
              <th className="px-2 py-1.5">店铺</th>
              <th className="px-2 py-1.5">ASIN / 关键词</th>
              <th className="px-2 py-1.5">数据依据（14天）</th>
              <th className="px-2 py-1.5">预期影响</th>
              <th className="px-2 py-1.5">状态</th>
            </tr>
          </thead>
          <tbody>
            {(data?.proposals ?? []).map(p => {
              const kind = kindMeta[p.kind] ?? { label: p.kind, className: "border-border bg-surface-muted text-muted" };
              const proposed = p.proposed.state ? "暂停投放" : `bid × ${p.proposed.bidMultiplier}`;
              return (
                <tr key={p.id} className="border-t border-[var(--sf-line)] align-top">
                  <td className="px-2 py-1.5">{p.status === "PENDING" ? <input type="checkbox" aria-label={`选择方案 ${p.id}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} /> : null}</td>
                  <td className="px-2 py-1.5">{p.status === "APPROVED" ? <input type="checkbox" aria-label={`执行方案 ${p.id}`} checked={selectedApproved.has(p.id)} onChange={() => toggleApproved(p.id)} /> : null}</td>
                  <td className="px-2 py-1.5"><span className={`inline-block border px-1.5 py-0.5 ${kind.className}`}>{kind.label}</span></td>
                  <td className="px-2 py-1.5 font-medium">{actionText[p.action] ?? p.action}<div className="text-muted">{proposed}</div></td>
                  <td className="px-2 py-1.5">{p.store?.name || p.storeId}</td>
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{p.asin}</div>
                    <div className="text-muted">{p.label ?? p.externalId.slice(0, 18)}</div>
                  </td>
                  <td className="px-2 py-1.5 text-muted">
                    花费 {p.basis.currency ? `${p.basis.currency} ` : ""}{p.basis.cost?.toFixed(2) ?? "—"} · 点击 {p.basis.clicks ?? 0} · 单 {p.basis.adOrders ?? 0}
                    {p.basis.acosPct != null ? <div>ACOS {p.basis.acosPct}%</div> : null}
                    {p.basis.coverDays != null ? <div>可售 {p.basis.coverDays} 天（在手 {p.basis.onHand ?? 0}）</div> : null}
                  </td>
                  <td className="max-w-[280px] px-2 py-1.5 text-muted">{p.expectedImpact}</td>
                  <td className="px-2 py-1.5">{statusText[p.status] ?? p.status}{p.decisionReason ? <div className="text-muted">{p.decisionReason}</div> : null}{p.executionNote ? <div className="text-muted">{p.executionNote}</div> : null}</td>
                </tr>
              );
            })}
            {!data?.proposals.length ? <tr><td colSpan={9} className="px-2 py-6 text-center text-muted">暂无方案，点击「重新生成方案」分析最近 14 天数据</td></tr> : null}
          </tbody>
        </table>
      </div>
      {canEdit && selected.size ? (
        <footer className="flex items-center gap-2 border-t border-[var(--sf-line)] bg-surface-muted px-3 py-2">
          <span className="text-xs text-muted">已选 {selected.size} 条</span>
          <button type="button" onClick={() => void act("decide", [...selected])} disabled={busy !== ""}
            className="h-7 border border-success/30 bg-success-soft px-2 text-xs text-success-ink hover:bg-success-soft disabled:opacity-50">批准所选</button>
          <button type="button" onClick={() => void act("reject", [...selected])} disabled={busy !== ""}
            className="h-7 border border-danger/30 bg-danger-soft px-2 text-xs text-danger-ink hover:bg-danger-soft disabled:opacity-50">驳回所选</button>
        </footer>
      ) : null}
      {canEdit && selectedApproved.size ? (
        <footer className="flex items-center gap-2 border-t border-warning-ink/30 bg-warning-soft px-3 py-2">
          <span className="text-xs text-warning-ink">已批准 {selectedApproved.size} 条 · 写回需双人复核与授权，当前将被闸门拦截</span>
          <button type="button" onClick={() => void act("execute", [...selectedApproved])} disabled={busy !== ""}
            className="h-7 border border-warning-ink/40 px-2 text-xs text-warning-ink hover:border-warning-ink disabled:opacity-50">执行写回（受闸门）</button>
        </footer>
      ) : null}
    </section>
  );
}
