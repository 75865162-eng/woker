"use client";

import type { FbaLocalPlansResult } from "@/lib/fba-local/service";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";

// Layout adapted from Wimoor ship/ship_plan and shipv2/two_box: plan list → box details.
// Copyright (c) 2022 深圳市万墨信息科技有限公司. MIT: public/licenses/wimoor-MIT.txt.
export function FbaPlanTable({ plans, disabled, onSelect, purpose = "packing" }: {
  plans: FbaLocalPlansResult["items"]; disabled: boolean; onSelect: (id: string) => void; purpose?: "packing" | "shipping";
}) {
  const columns: DataTableColumn<FbaLocalPlansResult["items"][number]>[] = [
    { key: 'number', header: '计划单号', width: 140, render: plan => <span className="font-semibold">{plan.number}</span> },
    {
      key: 'status', header: '状态', width: 118,
      render: plan => plan.status === 'CANCELLED'
        ? <StatusPill tone="neutral">已取消</StatusPill>
        : plan.status === 'DRAFT' ? <StatusPill tone="warning">草稿</StatusPill> : <StatusPill tone="info" dot>库存交接中</StatusPill>,
    },
    {
      key: 'warehouse', header: '仓库 / 商品明细',
      render: plan => <>{[...new Set(plan.lines.map(line => line.stock?.warehouseCode).filter(Boolean))].join('、') || '未返回仓库'}<span className="mt-1 block text-meta text-muted">{plan.lines.length} 条明细</span></>,
    },
    { key: 'plannedQty', header: '计划数量', width: 96, numeric: true, render: plan => plan.fulfillment.plannedQty },
    { key: 'packing', header: '装箱资料', width: 156, render: plan => (plan.packing ? `${plan.packing.boxes.length} 箱 · 本地已保存` : '未填写') },
    { key: 'dispatched', header: '公司仓出库', width: 140, numeric: true, render: plan => `${plan.fulfillment.dispatchedQty} / ${plan.fulfillment.plannedQty}` },
    ...(purpose === 'shipping' ? [
      {
        key: 'forwarder', header: '货代 / 渠道', width: 150,
        render: (plan: FbaLocalPlansResult["items"][number]) => plan.forwarderOrder
          ? <>{plan.forwarderOrder.forwarder}<span className="block text-meta text-muted">{plan.forwarderOrder.channel}</span></>
          : '尚未委托',
      },
      {
        key: 'evidence', header: '运输凭据', width: 160,
        render: (plan: FbaLocalPlansResult["items"][number]) => plan.forwarderOrder?.billOfLading || plan.forwarderOrder?.containerNumber || '未录入',
      },
    ] : []),
    {
      key: 'actions', header: '操作', width: 104, align: 'right',
      render: plan => <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onSelect(plan.id)}>{purpose === 'packing' ? '装箱详情' : '发货详情'}</Button>,
    },
  ];

  return <DataTable
    rows={plans}
    getRowKey={plan => plan.id}
    ariaLabel={purpose === 'packing' ? '本地计划装箱列表' : '本地发货计划列表'}
    empty={purpose === 'packing' ? '还没有本地装箱计划。' : '还没有本地发货计划。'}
    columns={columns}
  />;
}
