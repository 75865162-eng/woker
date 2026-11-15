"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WorkbenchDialog } from "@/components/ui/workbench-dialog";
import { StandardDataTable } from "@/components/ui/table-variants";
import { type DataTableColumn } from "@/components/ui/data-table";

// Layout adapted from Wimoor erp/warehouse/transfer/index.vue and components/details.vue.
// Copyright (c) 2022 深圳市万墨信息科技有限公司. MIT: public/licenses/wimoor-MIT.txt.
export type TransferOrderView = {
  id: string; number: string; status: string; revision: number; createdBy: string;
  reason: string; createdAt?: string;
  lines: Array<{
    id: string; quantity: number; shippedQty: number; receivedQty: number; discrepancyQty: number;
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

// Net in-transit = shipped - received - discrepancy (discrepancy is only a
// reclassification of in-transit quantity, never a stock movement).
const netInTransit = (line: { shippedQty: number; receivedQty: number; discrepancyQty: number }) => line.shippedQty - line.receivedQty - (line.discrepancyQty ?? 0);

export function WmsTransferTable({ orders, disabled, actions, onApprovals }: {
  orders: TransferOrderView[]; disabled: boolean;
  actions: (order: TransferOrderView) => ReactNode; onApprovals: (orderId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Derive from the current response so refresh, pagination, or revoked reads cannot retain stale details.
  const selected = orders.find(order => order.id === selectedId);
  const sumLineQuantities = (order: TransferOrderView) => order.lines.reduce(
    (sum, line) => ({ planned: sum.planned + line.quantity, shipped: sum.shipped + line.shippedQty, received: sum.received + line.receivedQty, discrepancy: sum.discrepancy + (line.discrepancyQty ?? 0) }),
    { planned: 0, shipped: 0, received: 0, discrepancy: 0 },
  );
  const transferOrderColumns: DataTableColumn<TransferOrderView>[] = [
    { key: "number", header: "调拨单号", render: (order) => <>{order.number}<span className="block text-xs text-muted">版本 {order.revision}</span></> },
    { key: "source", header: "调出库位", render: (order) => [...new Set(order.lines.map(line => line.source.location.code))].join("、") },
    { key: "target", header: "调入库位", render: (order) => [...new Set(order.lines.map(line => line.target.code))].join("、") },
    { key: "status", header: "状态", render: (order) => <Status value={order.status} /> },
    { key: "quantities", header: "计划 / 已发 / 已收", numeric: true, render: (order) => { const q = sumLineQuantities(order); return `${q.planned} / ${q.shipped} / ${q.received}`; } },
    { key: "discrepancy", header: "差异", numeric: true, render: (order) => sumLineQuantities(order).discrepancy },
    { key: "netInTransit", header: "净在途", numeric: true, render: (order) => { const q = sumLineQuantities(order); return q.shipped - q.received - q.discrepancy; } },
    { key: "createdBy", header: "申请人", render: (order) => order.createdBy },
    { key: "createdAt", header: "创建时间", render: (order) => order.createdAt ? new Date(order.createdAt).toLocaleString() : "未返回" },
    { key: "action", header: "操作", render: (order) => <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={disabled} onClick={() => setSelectedId(order.id)}>调拨详情</Button>{actions(order)}</div> },
  ];
  const transferLineColumns: DataTableColumn<TransferOrderView["lines"][number]>[] = [
    { key: "lot", header: "批次", render: (line) => line.source.lot.lotCode },
    { key: "source", header: "调出库位", render: (line) => line.source.location.code },
    { key: "target", header: "调入库位", render: (line) => line.target.code },
    { key: "quantity", header: "计划", numeric: true, render: (line) => line.quantity },
    { key: "shippedQty", header: "已发", numeric: true, render: (line) => line.shippedQty },
    { key: "receivedQty", header: "已收", numeric: true, render: (line) => line.receivedQty },
    { key: "discrepancyQty", header: "差异", numeric: true, render: (line) => line.discrepancyQty ?? 0 },
    { key: "netInTransit", header: "净在途", numeric: true, render: (line) => netInTransit(line) },
    { key: "remaining", header: "待发", numeric: true, render: (line) => line.quantity - line.shippedQty },
  ];
  return <>
    <StandardDataTable
      ariaLabel="在途调拨单列表"
      rows={orders}
      getRowKey={(order) => order.id}
      columns={transferOrderColumns}
      rowAttributes={(order) => ({ "data-transfer-order-id": order.id })}
      empty={disabled ? "正在读取调拨单…" : "当前条件下没有调拨单。"}
    />
    <WorkbenchDialog open={!!selected} title="在途调拨详情" drawer onClose={() => setSelectedId(null)}>
      {selected && <div className="space-y-5">
        <section aria-label="调拨单据资料"><dl className="grid gap-4 text-sm sm:grid-cols-2">
          {[["单据编码", selected.number], ["申请人 ID", selected.createdBy], ["版本", String(selected.revision)], ["创建时间", selected.createdAt ? new Date(selected.createdAt).toLocaleString() : "未返回"]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>)}
          <div><dt className="text-xs text-muted">当前状态</dt><dd className="mt-1"><Status value={selected.status} /></dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-muted">调拨依据</dt><dd className="mt-1 whitespace-pre-wrap">{selected.reason}</dd></div>
        </dl></section>
        <section aria-label="调拨商品明细"><h3 className="mb-2 text-sm font-semibold">调拨商品与数量进度</h3>
          <StandardDataTable
            ariaLabel="调拨商品与数量进度"
            rows={selected.lines}
            getRowKey={(line) => line.id}
            columns={transferLineColumns}
            empty="暂无调拨商品明细。"
          />
        </section>
        <p className="text-xs text-muted">草稿不占库存；发出和签收分别审批。净在途 = 已发 - 已收 - 差异；差异仅重分类在途量，不生成库存流水。取消或完成状态以服务端结果为准。</p>
        <div className="flex flex-wrap gap-2">{actions(selected)}<Button size="sm" variant="secondary" onClick={() => { setSelectedId(null); onApprovals(selected.id); }}>查看仓库审批</Button></div>
      </div>}
    </WorkbenchDialog>
  </>;
}
