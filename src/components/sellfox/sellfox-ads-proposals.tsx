"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { normalizeWorkspaceScope } from "@/lib/workspace/scope";

type Proposal = {
  id: string; storeId: string; asin: string; msku: string | null; kind: string; action: string;
  entityType: string; externalId: string; label: string | null; proposed: { bidMultiplier?: number; state?: string };
  basis: { clicks?: number; cost?: number; adOrders?: number; acosPct?: number | null; spend7d?: number; coverDays?: number | null; onHand?: number | null };
  expectedImpact: string | null; status: string; decisionReason: string | null; createdAt: string;
  store: { name: string; marketplace: string; country: string } | null;
};
type Response = { proposals: Proposal[]; counts: Record<string, number>; writeExecution: { enabled: boolean; note: string } };

const kindMeta: Record<string, { label: string; className: string }> = {
  STOCKOUT_RISK: { label: "断货风险", className: "border-red-200 bg-red-50 text-red-700" },
  NO_CONVERSION: { label: "0转化止血", className: "border-amber-200 bg-amber-50 text-amber-700" },
  HIGH_ACOS: { label: "高ACOS", className: "border-orange-200 bg-orange-50 text-orange-700" },
  HIGH_POTENTIAL: { label: "高潜力加码", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
};
const actionText: Record<string, string> = { LOWER_BID: "降价", RAISE_BID: "加价", PAUSE: "暂停" };
const statusText: Record<string, string> = { PENDING: "待审批", APPROVED: "已批准", REJECTED: "已驳回", EXECUTED: "已执行", FAILED: "执行失败" };

export function SellfoxAdsProposals() {
  const shellUser = useAppShellUser();
  const canEdit = roleCanPerformAction(shellUser?.userRole, "sellfox", "edit", shellUser?.rolePermissions);
  const scope = useMemo(() => normalizeWorkspaceScope(), []);
  const [data, setData] = useState<Response | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
      if (action === "decide") { setNotice(`已批准 ${body.approved} 条，待双人复核后执行`); setSelected(new Set()); }
      if (action === "reject") { setNotice(`已驳回 ${body.rejected} 条`); setSelected(new Set()); }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(""); }
  };

  const pending = data?.proposals.filter(p => p.status === "PENDING") ?? [];
  const toggle = (id: string) => setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return (
    <section className="border border-[var(--sf-line)] bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--sf-line)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[var(--sf-blue)]" />
          <h2 className="text-sm font-medium">库存 × 广告优化方案</h2>
          <span className="text-xs text-slate-500">
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
      {notice ? <div className="border-b border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">{notice}</div> : null}
      {error ? <div role="alert" className="border-b border-red-100 bg-red-50 px-3 py-1.5 text-xs text-red-700">{error}</div> : null}
      {data?.writeExecution.enabled === false ? (
        <div className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
          {data.writeExecution.note}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="w-8 px-2 py-1.5"><input type="checkbox" aria-label="全选待审批" checked={pending.length > 0 && pending.every(p => selected.has(p.id))} onChange={e => setSelected(e.target.checked ? new Set(pending.map(p => p.id)) : new Set())} /></th>
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
              const kind = kindMeta[p.kind] ?? { label: p.kind, className: "border-slate-200 bg-slate-50 text-slate-600" };
              const proposed = p.proposed.state ? "暂停投放" : `bid × ${p.proposed.bidMultiplier}`;
              return (
                <tr key={p.id} className="border-t border-[var(--sf-line)] align-top">
                  <td className="px-2 py-1.5">{p.status === "PENDING" ? <input type="checkbox" aria-label={`选择方案 ${p.id}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} /> : null}</td>
                  <td className="px-2 py-1.5"><span className={`inline-block border px-1.5 py-0.5 ${kind.className}`}>{kind.label}</span></td>
                  <td className="px-2 py-1.5 font-medium">{actionText[p.action] ?? p.action}<div className="text-slate-400">{proposed}</div></td>
                  <td className="px-2 py-1.5">{p.store?.name || p.storeId}</td>
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{p.asin}</div>
                    <div className="text-slate-400">{p.label ?? p.externalId.slice(0, 18)}</div>
                  </td>
                  <td className="px-2 py-1.5 text-slate-600">
                    花费 ${p.basis.cost?.toFixed(2) ?? "—"} · 点击 {p.basis.clicks ?? 0} · 单 {p.basis.adOrders ?? 0}
                    {p.basis.acosPct != null ? <div>ACOS {p.basis.acosPct}%</div> : null}
                    {p.basis.coverDays != null ? <div>可售 {p.basis.coverDays} 天（在手 {p.basis.onHand ?? 0}）</div> : null}
                  </td>
                  <td className="max-w-[280px] px-2 py-1.5 text-slate-600">{p.expectedImpact}</td>
                  <td className="px-2 py-1.5">{statusText[p.status] ?? p.status}{p.decisionReason ? <div className="text-slate-400">{p.decisionReason}</div> : null}</td>
                </tr>
              );
            })}
            {!data?.proposals.length ? <tr><td colSpan={8} className="px-2 py-6 text-center text-slate-400">暂无方案，点击「重新生成方案」分析最近 14 天数据</td></tr> : null}
          </tbody>
        </table>
      </div>
      {canEdit && selected.size ? (
        <footer className="flex items-center gap-2 border-t border-[var(--sf-line)] bg-slate-50 px-3 py-2">
          <span className="text-xs text-slate-500">已选 {selected.size} 条</span>
          <button type="button" onClick={() => void act("decide", [...selected])} disabled={busy !== ""}
            className="h-7 border border-emerald-300 bg-emerald-50 px-2 text-xs text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">批准所选</button>
          <button type="button" onClick={() => void act("reject", [...selected])} disabled={busy !== ""}
            className="h-7 border border-red-200 bg-red-50 px-2 text-xs text-red-700 hover:bg-red-100 disabled:opacity-50">驳回所选</button>
        </footer>
      ) : null}
    </section>
  );
}
