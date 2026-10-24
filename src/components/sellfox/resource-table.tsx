import { Button } from "@/components/ui/button";
import type { SellfoxDomain } from "@/lib/sellfox/workbench-view";
import { captions, display, runProgress, type Row, type Pagination } from "./workbench-types";

export function SellfoxResourceTable({ domain, rows, pagination, loading, page, onPage, onSelect }: { domain: SellfoxDomain; rows: Row[]; pagination: Pagination; loading: boolean; page: number; onPage: (page: number) => void; onSelect: (row: Row) => void }) {
  const columns = domain === "runs" ? ["resource", "status", "progress", "startedAt", "finishedAt", "error"]
    : domain === "stores" ? ["name", "externalId", "marketplace", "country", "status", "lastSyncedAt"]
      : domain === "inventory" ? ["reportDate", "capturedAt", "name", "marketplace", "asin", "msku", "sku", "fnsku", "quantity", "totalInventory", "inTransit", "inboundWorking", "inboundShipped", "inboundReceiving", "reservedTransfer", "reservedProcessing", "reservedCustomerorders", "unfulfillable", "warehouseName"]
        : domain === "sales" ? ["reportDate", "name", "marketplace", "asin", "msku", "sku", "quantity", "revenue", "currency"]
          : domain === "listings" ? ["name", "marketplace", "status", "asin", "msku", "parentAsin", "title", "price", "fulfillable", "sales7", "sales14", "sales30", "adSpend7", "adSpend14", "adSpend30", "capturedAt"]
          : domain === "ads" ? ["reportDate", "name", "marketplace", "adType", "campaignId", "adGroupId", "productId", "asin", "msku", "impressions", "clicks", "cost", "adSales", "adOrders", "acos", "roas"]
            : ["reportDate", "name", "marketplace", "asin", "msku", "sku", "title", "saleQuantity", "fbaQuantity", "fbmQuantity", "saleRevenue", "grossProfit", "grossProfitRate", "adCost", "refundRate", "orderNum", "netRevenue", "currency"];
  return <section className="border border-border bg-white" aria-busy={loading}>
    <div className="max-h-[62vh] overflow-auto thin-scrollbar"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 bg-surface-muted text-muted"><tr>{columns.map((key) => <th key={key} className="whitespace-nowrap px-3 py-2.5 font-semibold">{domain === "sales" && key === "quantity" ? "销量" : captions[key] ?? key}</th>)}<th className="px-3 py-2.5">详情</th></tr></thead>
      <tbody>{rows.map((row, index) => {
        const store = row.SellfoxStore as Row | undefined;
        const enriched: Row = { ...row, name: store?.name ?? row.name, marketplace: store?.marketplace ?? row.marketplace, progress: runProgress(row) };
        return <tr key={String(row.id ?? index)} onClick={() => onSelect(row)} className="cursor-pointer border-t border-border align-top hover:bg-surface-muted/50">{columns.map((key) => <td key={key} title={display(enriched[key], key)} className="max-w-[260px] truncate whitespace-nowrap px-3 py-2.5">{display(enriched[key], key)}</td>)}<td className="px-3 py-2.5"><button aria-label={`查看记录 ${String(row.id ?? index)}`} onClick={(event) => { event.stopPropagation(); onSelect(row); }} className="text-brand">查看</button></td></tr>;
      })}{rows.length === 0 ? <tr><td className="px-4 py-10 text-center text-muted" colSpan={columns.length + 1}>{loading ? "正在读取…" : "当前筛选暂无数据。"}</td></tr> : null}</tbody></table></div>
    <footer className="flex items-center justify-between border-t border-border px-3 py-2 text-xs"><span>第 {pagination.page} 页 / {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))} 页 · {pagination.total.toLocaleString()} 条</span><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1 || loading} onClick={() => onPage(Math.max(1, page - 1))}>上一页</Button><Button size="sm" variant="secondary" disabled={page >= Math.ceil(pagination.total / pagination.pageSize) || loading} onClick={() => onPage(page + 1)}>下一页</Button></div></footer>
  </section>;
}
