"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WorkbenchDialog } from "@/components/ui/workbench-dialog";

// Layout adapted from Wimoor erp/warehouse/transfer/index.vue and components/details.vue.
// Copyright (c) 2022 深圳市万墨信息科技有限公司. MIT: public/licenses/wimoor-MIT.txt.
export type TransferOrderView = {
  id: string; number: string; status: string; revision: number; createdBy: string;
  reason: string; createdAt?: string;
  lines: Array<{
    id: string; quantity: number; shippedQty: number; receivedQty: number;
    sourceBalanceId: string; targetLocationId: string;
    source: { location: { code: string }; lot: { lotCode: string } };
    target: { code: string };
  }>;
};

export const transferStatusLabels: Record<string, string> = {
  DRAFT: "草稿", PARTIALLY_SHIPPED: "部分发出", IN_TRANSIT: "全部发出待签收",
  PARTIALLY_RECEIVED: "部分签收", COMPLETED: "已完成", CANCELLED: "已取消",
};

function Status({ value }: { value: string }) {
  return <Badge tone={value === "COMPLETED" ? "green" : value === "CANCELLED" ? "gray" : "amber"}>{transferStatusLabels[value] ?? value}</Badge>;
}

export function WmsTransferTable({ orders, disabled, actions, onApprovals }: {
  orders: TransferOrderView[]; disabled: boolean;
  actions: (order: TransferOrderView) => ReactNode; onApprovals: (orderId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Derive from the current response so refresh, pagination, or revoked reads cannot retain stale details.
  const selected = orders.find(order => order.id === selectedId);
  return <>
    <div className="overflow-x-auto rounded border border-border">
      <table aria-label="在途调拨单列表" className="w-full min-w-[980px] text-left text-sm">
        <thead className="bg-background text-muted"><tr>{["调拨单号", "调出库位", "调入库位", "状态", "计划 / 已发 / 已收", "在途", "申请人", "创建时间", "操作"].map(label => <th key={label} className="border-b border-border px-3 py-3 font-medium">{label}</th>)}</tr></thead>
        <tbody>{orders.map(order => {
          const quantities = order.lines.reduce((sum, line) => ({ planned: sum.planned + line.quantity, shipped: sum.shipped + line.shippedQty, received: sum.received + line.receivedQty }), { planned: 0, shipped: 0, received: 0 });
          return <tr key={order.id} data-transfer-order-id={order.id} className="border-b border-border last:border-0">
            <td className="px-3 py-3 font-medium">{order.number}<span className="block text-xs text-muted">版本 {order.revision}</span></td>
            <td className="px-3 py-3">{[...new Set(order.lines.map(line => line.source.location.code))].join("、")}</td>
            <td className="px-3 py-3">{[...new Set(order.lines.map(line => line.target.code))].join("、")}</td>
            <td className="px-3 py-3"><Status value={order.status} /></td>
            <td className="px-3 py-3 tabular-nums">{quantities.planned} / {quantities.shipped} / {quantities.received}</td>
            <td className="px-3 py-3 tabular-nums">{quantities.shipped - quantities.received}</td>
            <td className="px-3 py-3">{order.createdBy}</td>
            <td className="px-3 py-3">{order.createdAt ? new Date(order.createdAt).toLocaleString() : "未返回"}</td>
            <td className="px-3 py-3"><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={disabled} onClick={() => setSelectedId(order.id)}>调拨详情</Button>{actions(order)}</div></td>
          </tr>;
        })}</tbody>
      </table>
      {!orders.length && <p className="p-6 text-center text-sm text-muted">{disabled ? "正在读取调拨单…" : "当前条件下没有调拨单。"}</p>}
    </div>
    <WorkbenchDialog open={!!selected} title="在途调拨详情" drawer onClose={() => setSelectedId(null)}>
      {selected && <div className="space-y-5">
        <section aria-label="调拨单据资料"><dl className="grid gap-4 text-sm sm:grid-cols-2">
          {[["单据编码", selected.number], ["申请人 ID", selected.createdBy], ["版本", String(selected.revision)], ["创建时间", selected.createdAt ? new Date(selected.createdAt).toLocaleString() : "未返回"]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>)}
          <div><dt className="text-xs text-muted">当前状态</dt><dd className="mt-1"><Status value={selected.status} /></dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-muted">调拨依据</dt><dd className="mt-1 whitespace-pre-wrap">{selected.reason}</dd></div>
        </dl></section>
        <section aria-label="调拨商品明细"><h3 className="mb-2 text-sm font-semibold">调拨商品与数量进度</h3><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["批次", "调出库位", "调入库位", "计划", "已发", "已收", "在途", "待发"].map(label => <th key={label} className="whitespace-nowrap border-b border-border p-2">{label}</th>)}</tr></thead><tbody>{selected.lines.map(line => <tr key={line.id}><td className="p-2">{line.source.lot.lotCode}</td><td className="p-2">{line.source.location.code}</td><td className="p-2">{line.target.code}</td><td className="p-2">{line.quantity}</td><td className="p-2">{line.shippedQty}</td><td className="p-2">{line.receivedQty}</td><td className="p-2">{line.shippedQty - line.receivedQty}</td><td className="p-2">{line.quantity - line.shippedQty}</td></tr>)}</tbody></table></div></section>
        <p className="text-xs text-muted">草稿不占库存；发出和签收分别审批。在途数量尚未进入目的可用库存。取消或完成状态以服务端结果为准。</p>
        <div className="flex flex-wrap gap-2">{actions(selected)}<Button size="sm" variant="secondary" onClick={() => { setSelectedId(null); onApprovals(selected.id); }}>查看仓库审批</Button></div>
      </div>}
    </WorkbenchDialog>
  </>;
}
