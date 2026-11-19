"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { WorkbenchPagination } from "@/components/ui/workbench-pagination";
import { getJson } from "@/lib/workspace/get-json";

type DetailRow = {
  id: string;
  store: string;
  marketplace: string;
  sellerOrderId: string;
  amazonOrderId: string | null;
  status: string | null;
  purchaseDate: string | null;
  currency: string | null;
  orderTotal: number | null;
  productAmount: number | null;
  commission: number | null;
  fbaFee: number | null;
  purchaseCost: number | null;
  orderProfit: number | null;
  totalCost: number | null;
  refundPrice: number | null;
  settlementStatus: string | null;
  payload: unknown;
  latestCapturedAt: string;
};

type Response = {
  rows: DetailRow[];
  facets: { statuses: string[] };
  pagination: { page: number; pageSize: number; total: number };
  error?: string;
};

const money = (value: number | null, currency?: string | null) =>
  value === null ? "-" : `${currency ? currency + " " : ""}${Number(value).toFixed(2)}`;
const text = (value: string | null) => value || "-";

/** 订单详情只读承接页：数据来自赛狐订单详情批量接口原始响应，缺失字段保留 -，不补零。 */
export function OrderDetailWorkbench() {
  const [rows, setRows] = useState<DetailRow[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<DetailRow | null>(null);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (status) params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    setLoading(true);
    getJson<Response>(`/api/sellfox/order-detail?${params.toString()}`)
      .then(({ data }) => {
        if (!active) return;
        if (data.error) { setError(data.error); setRows([]); }
        else { setError(null); setRows(data.rows ?? []); setStatuses(data.facets?.statuses ?? []); setTotal(data.pagination?.total ?? 0); }
      })
      .catch((e) => { if (active) { setError(e instanceof Error ? e.message : "读取失败"); setRows([]); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, status, search]);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="搜索卖家订单号 / 亚马逊订单号"
          className="h-8 w-72 border border-border bg-surface px-2 text-xs text-foreground"
        />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-8 border border-border bg-surface px-2 text-xs text-foreground" aria-label="订单状态">
          <option value="">全部状态</option>
          {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <span className="ml-auto text-muted">来源：赛狐订单详情批量接口 · 原始行字段不猜不补</span>
      </div>

      {error ? <div className="border border-danger bg-danger/10 p-3 text-xs text-danger">{error}</div> : null}

      <div className="overflow-x-auto border border-border">
        <table className="w-full min-w-[1100px] text-xs">
          <thead className="bg-surface-muted text-left text-label">
            <tr>
              {["店铺", "卖家订单号", "亚马逊订单号", "状态", "下单时间", "订单金额", "商品金额", "佣金", "FBA运费", "采购成本", "订单利润", "退款", "结算状态", "原始行"].map((h) => <th key={h} className="whitespace-nowrap border-b border-border px-2 py-2 font-normal">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border/60 hover:bg-surface-muted/50">
                <td className="whitespace-nowrap px-2 py-1.5">{text(row.store)}{row.marketplace ? ` / ${row.marketplace}` : ""}</td>
                <td className="whitespace-nowrap px-2 py-1.5 font-mono">{row.sellerOrderId}</td>
                <td className="whitespace-nowrap px-2 py-1.5 font-mono">{text(row.amazonOrderId)}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{text(row.status)}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{text(row.purchaseDate)}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{money(row.orderTotal, row.currency)}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{money(row.productAmount, row.currency)}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{money(row.commission, row.currency)}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{money(row.fbaFee, row.currency)}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{money(row.purchaseCost, row.currency)}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{money(row.orderProfit, row.currency)}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{money(row.refundPrice, row.currency)}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{text(row.settlementStatus)}</td>
                <td className="whitespace-nowrap px-2 py-1.5"><button className="text-brand underline" onClick={() => setRaw(row)}>查看</button></td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? <tr><td colSpan={14} className="px-2 py-8 text-center text-muted">暂无订单详情数据；请先在同步控制台跑「订单详情」同步。</td></tr> : null}
          </tbody>
        </table>
      </div>

      <WorkbenchPagination total={total} page={page} pageSize={50} onPage={setPage} note="订单详情（一单一行）" />

      {raw ? (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={() => setRaw(null)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto border border-border bg-surface p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium">原始响应 · {raw.sellerOrderId}</h3>
              <Button size="sm" variant="secondary" onClick={() => setRaw(null)}>关闭</Button>
            </div>
            <pre className="whitespace-pre-wrap break-all bg-surface-muted p-3 text-[11px] leading-relaxed">{JSON.stringify(raw.payload, null, 2)}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
