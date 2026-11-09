"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Entry = { id: string; kind: string; delta: number; status: string; balanceAfter: number; provider: string | null;
  tool: string | null; workspaceId: string | null; runId: string | null; callId: string | null; note: string; createdAt: string };
type Quota = { balance: number; used: number; pending: number; entries: Entry[]; page: number; hasNext: boolean };
const statuses: Record<string, string> = { RESERVED: "已预扣 · 待核对", COMPLETED: "已完成", FAILED: "请求失败 · 已扣次", UNKNOWN: "结果未知 · 待核对", REFUNDED: "未发送 · 已退回" };

export function CallQuotaView() {
  const [data, setData] = useState<Quota | null>(null);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError("");
    void fetch(`/api/lili/call-quota?page=${page}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("读取失败");
      const result = await response.json() as Quota;
      if (!controller.signal.aborted) setData(result);
    }).catch(() => { if (!controller.signal.aborted) setError("暂时无法读取调用额度，请重试。"); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [page, refresh]);
  return <div className="space-y-5">
    <section className="lili-card space-y-3 p-5">
      <div className="flex items-center justify-between gap-3"><h1 className="text-xl font-semibold">调用额度与扣减记录</h1>
        <button className="lili-btn-ghost" disabled={busy} onClick={() => setRefresh(value => value + 1)}>刷新</button></div>
      <p>每个同事账号拥有独立账本，新建账号初始余额为 0。同一 ERP 账号与 Lili 共用额度，在当前组织内跨工作区使用，卖家精灵和西柚共同扣减。</p>
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      {busy ? <p role="status">正在读取…</p> : null}
      {data && !error ? <div className="grid gap-4 sm:grid-cols-3" aria-busy={busy}>
        {[ ["剩余可用次数", data.balance], ["累计扣减次数（含待核对）", data.used], ["待核对请求", data.pending] ].map(([label, value]) =>
          <div key={label} className="rounded-lg border p-4"><div className="text-sm text-muted">{label}</div><div className="mt-2 text-3xl font-semibold">{Number(value).toLocaleString("zh-CN")}</div></div>)}
      </div> : null}
      <p className="text-sm text-muted">每次市场请求预扣 1 次。明确未发送的请求退回；已发送后失败、超时或结果未知的请求保留扣减。目录、技能和 ERP 数据读取不扣次。供应商积分和费用单独计算；每个研究任务首次付费请求需人工授权，后续请求遵守该任务已保存的调用上限。</p>
      <p className="text-sm text-muted">额度调整由管理员受控维护并记录审计。本页展示额度和流水，不提供在线支付。</p>
    </section>
    {data && !error ? <section className="lili-card space-y-3 p-5"><h2 className="font-semibold">额度流水</h2>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b">
        {["时间", "来源 / 工具", "变化", "余额快照", "状态 / 说明", "追溯"].map(title => <th key={title} className="whitespace-nowrap p-3">{title}</th>)}
      </tr></thead><tbody>{data.entries.map(entry => <tr key={entry.id} className="border-b align-top">
        <td className="whitespace-nowrap p-3">{new Date(entry.createdAt).toLocaleString("zh-CN")}</td>
        <td className="p-3">{entry.provider === "sellersprite" ? "卖家精灵" : entry.provider === "xiyou" ? "西柚" : "管理员额度调整"}<div className="text-xs text-muted">{entry.tool}</div></td>
        <td className="p-3">{entry.delta > 0 ? "+" : ""}{entry.delta} 次{entry.status === "REFUNDED" ? "（已退回 1 次）" : ""}</td>
        <td className="p-3">{entry.balanceAfter.toLocaleString("zh-CN")}</td>
        <td className="p-3">{statuses[entry.status] ?? entry.status}<div className="text-xs text-muted">{entry.note}</div></td>
        <td className="max-w-64 break-all p-3 text-xs">{entry.runId ? <Link className="underline" href={`/agents/selection-research?workspaceId=${encodeURIComponent(entry.workspaceId ?? "default")}&runId=${encodeURIComponent(entry.runId)}`}>研究任务</Link> : null}
          {entry.workspaceId ? <div>工作区：{entry.workspaceId}</div> : null}{entry.callId ? <div>请求：{entry.callId}</div> : null}<div>流水：{entry.id}</div></td>
      </tr>)}</tbody></table></div>
      {!data.entries.length ? <p>暂无额度流水。</p> : null}
      <div className="flex items-center gap-3"><button className="lili-btn-ghost" disabled={busy || data.page <= 1} onClick={() => setPage(data.page - 1)}>上一页</button>
        <span>第 {data.page} 页</span><button className="lili-btn-ghost" disabled={busy || !data.hasNext} onClick={() => setPage(data.page + 1)}>下一页</button></div>
    </section> : null}
  </div>;
}
