"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AmazonReadDomain } from "@/lib/operations/types";

type Schedule = { resource: AmazonReadDomain; enabled: boolean; intervalMinutes: number; supported: boolean; source: string; lastEnqueuedAt: string | null; nextScheduledAt: string | null };
const labels = { inventory: "库存", orders: "订单", ads: "广告", catalog: "在线产品", finance: "财务", fulfillment: "履约" };
export function SyncSchedulesPanel({ headers, onSync, onChanged }: { headers: () => Headers; onSync: (resource?: AmazonReadDomain) => void; onChanged: () => void }) {
  const [rows, setRows] = useState<Schedule[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/operations/schedules", { headers: headers(), cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "计划读取失败。");
      if (!cancelled) { setRows(data.schedules); setCanEdit(data.canEdit); }
    }).catch((error) => { if (!cancelled) setNotice(error.message); });
    return () => { cancelled = true; };
  }, [headers]);
  async function save(row: Schedule) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/operations/schedules", {
        method: "PATCH", headers: new Headers([...headers(), ["Content-Type", "application/json"]]),
        body: JSON.stringify({ resource: row.resource, intervalMinutes: row.intervalMinutes, enabled: row.enabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "计划保存失败。");
      setRows(data.schedules); setNotice("计划已保存；启用后将在一个间隔后首次执行。"); onChanged();
    } catch (error) { setNotice(error instanceof Error ? error.message : "计划保存失败。"); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3">
    <div className="flex items-center justify-between"><h3 className="text-sm font-bold">同步与计划</h3><Button size="sm" onClick={() => onSync("inventory")}>立即同步库存</Button></div>
    <p className="text-xs text-muted">同工作区同域串行；Amazon 可能限流，失败重试最多 3 次。广告有归因延迟；库存是时点快照，可能与 Amazon 短暂不同。</p>
    {notice && <p role="status" className="text-sm text-amber-800">{notice}</p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>域</th><th>间隔（分钟）</th><th>状态</th><th>最近入队 / 下次计划</th><th>操作</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.resource} className="border-t border-border"><td className="py-3">{labels[row.resource]}</td><td><input aria-label={`${labels[row.resource]}同步间隔`} type="number" min={15} max={10080} value={row.intervalMinutes} disabled={!canEdit || !row.supported || busy} onChange={(e) => setRows((items) => items.map((item) => item.resource === row.resource ? { ...item, intervalMinutes: Number(e.target.value) } : item))} className="w-24 border border-border px-2 py-1" /></td><td>{row.supported ? row.enabled ? "已启用" : "已停用" : row.source === "sourced_from_ppc" ? "来自 PPC · 不另行拉数" : "NOT_SYNCED · worker 未接入"}</td><td className="text-xs text-muted">{row.lastEnqueuedAt ? new Date(row.lastEnqueuedAt).toLocaleString("zh-CN") : "尚未入队"}<br />{row.nextScheduledAt ? new Date(row.nextScheduledAt).toLocaleString("zh-CN") : "无计划"}</td><td>{row.supported && <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSync(row.resource)}>立即同步</Button>}{row.supported && canEdit && <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy} onClick={() => void save({ ...row, enabled: !row.enabled })}>{row.enabled ? "停用" : "启用"}</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => void save(row)}>保存间隔</Button></div>}</td></tr>)}
    </tbody></table></div>
    {!canEdit && <p className="text-xs text-muted">只读计划；修改需要经营中台编辑权限。手动同步沿用现有创建权限。</p>}
  </section>;
}
