"use client";

import type { FbaLocalPlansResult } from "@/lib/fba-local/service";
import { Button } from "@/components/ui/button";

// Layout adapted from Wimoor ship/ship_plan and shipv2/two_box: plan list → box details.
// Copyright (c) 2022 深圳市万墨信息科技有限公司. MIT: public/licenses/wimoor-MIT.txt.
export function FbaPlanTable({ plans, disabled, onSelect, purpose = "packing" }: {
  plans: FbaLocalPlansResult["items"]; disabled: boolean; onSelect: (id: string) => void; purpose?: "packing" | "shipping";
}) {
  return <div className="overflow-auto rounded-lg border border-border bg-surface">
    <table className="w-full min-w-[780px] text-left text-xs" aria-label={purpose === "packing" ? "本地计划装箱列表" : "本地发货计划列表"}>
      <thead className="bg-surface-muted"><tr>{["计划单号", "状态", "仓库 / 商品明细", "计划数量", "装箱资料", "公司仓出库", ...(purpose === "shipping" ? ["货代 / 渠道", "运输凭据"] : []), "操作"].map(label => <th key={label} className="whitespace-nowrap px-3 py-3 font-medium">{label}</th>)}</tr></thead>
      <tbody>{plans.map(plan => <tr key={plan.id} className="border-t border-border hover:bg-surface-muted/50">
        <td className="px-3 py-3 font-medium">{plan.number}</td>
        <td className="px-3 py-3"><span className="rounded border border-border px-2 py-1">{plan.status === "CANCELLED" ? "已取消" : plan.status === "DRAFT" ? "草稿" : "库存交接中"}</span></td>
        <td className="px-3 py-3">{[...new Set(plan.lines.map(line => line.stock?.warehouseCode).filter(Boolean))].join("、") || "未返回仓库"}<span className="mt-1 block text-muted">{plan.lines.length} 条明细</span></td>
        <td className="px-3 py-3">{plan.fulfillment.plannedQty}</td>
        <td className="px-3 py-3">{plan.packing ? `${plan.packing.boxes.length} 箱 · 本地已保存` : "未填写"}</td>
        <td className="px-3 py-3">{plan.fulfillment.dispatchedQty} / {plan.fulfillment.plannedQty}</td>
        {purpose === "shipping" && <><td className="px-3 py-3">{plan.forwarderOrder ? <>{plan.forwarderOrder.forwarder}<span className="block text-muted">{plan.forwarderOrder.channel}</span></> : "尚未委托"}</td><td className="px-3 py-3">{plan.forwarderOrder?.billOfLading || plan.forwarderOrder?.containerNumber || "未录入"}</td></>}
        <td className="px-3 py-3"><Button size="sm" variant="ghost" disabled={disabled} onClick={() => onSelect(plan.id)}>{purpose === "packing" ? "装箱详情" : "发货详情"}</Button></td>
      </tr>)}</tbody>
    </table>
  </div>;
}
