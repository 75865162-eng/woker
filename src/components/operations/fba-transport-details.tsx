"use client";

import { useState } from "react";
import type { FbaLocalPlansResult } from "@/lib/fba-local/service";
import { Button } from "@/components/ui/button";
import { WorkbenchDialog } from "@/components/ui/workbench-dialog";

const labels: Record<string, string> = { BOOKED: "已委托", IN_TRANSIT: "运输中", ARRIVED: "已抵达目的港/站", CLEARED: "已清关", DELIVERED: "货代已送达", CANCELLED: "已取消", DEPARTED: "已发运", NOTE: "补充记录", OCEAN: "海运", AIR: "空运", ROAD: "公路", RAIL: "铁路" };
type Transport = NonNullable<FbaLocalPlansResult['items'][number]['forwarderOrder']>;
// Layout adapted from Wimoor shipment_handing/list/components/transinfo.vue.
// Copyright (c) 2022 深圳市万墨信息科技有限公司. MIT: public/licenses/wimoor-MIT.txt.
export function FbaTransportDetails({ order }: { order: Transport }) {
  const [open, setOpen] = useState(false);
  const fields = [["委托单号", order.number], ["货代", order.forwarder], ["运输渠道", order.channel], ["运输方式", labels[order.mode] ?? order.mode], ["运输状态", labels[order.status] ?? order.status], ["目的地址", order.destination], ["柜号", order.containerNumber], ["提单号", order.billOfLading], ["船名航次 / 航班", order.vesselOrFlight], ["截单时间", order.cutoffAt ? new Date(order.cutoffAt).toISOString() : null], ["预计起运", order.departureEta ? new Date(order.departureEta).toISOString() : null], ["预计到达", order.arrivalEta ? new Date(order.arrivalEta).toISOString() : null]];
  return <><Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>运输详情</Button><WorkbenchDialog open={open} drawer title="货代运输详情" onClose={() => setOpen(false)}>
    <section aria-label="运输单据信息"><dl className="grid gap-4 rounded border border-border p-4 text-sm sm:grid-cols-2">{fields.map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-all">{value ?? "未录入"}</dd></div>)}</dl></section>
    <section aria-label="运输轨迹明细" className="mt-5 space-y-3"><h3 className="text-sm font-semibold">物流节点与凭据</h3><p className="text-xs text-muted">已登记 {order._count.events} 条，以下为接口返回的最近 50 条。时间以 UTC 显示；人工运输记录不表示 Amazon 收货状态。</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["发生时间（UTC）", "物流节点", "地点", "凭据 / 来源说明"].map(label => <th key={label} className="border-b border-border p-2">{label}</th>)}</tr></thead><tbody>{order.events.map(event => <tr key={event.id} className="border-b border-border last:border-0"><td className="whitespace-nowrap p-2">{new Date(event.occurredAt).toISOString()}</td><td className="whitespace-nowrap p-2">{labels[event.eventType] ?? event.eventType}</td><td className="p-2">{event.location}</td><td className="whitespace-pre-wrap break-words p-2">{event.evidence}</td></tr>)}</tbody></table>{!order.events.length && <p className="p-4 text-sm text-muted">尚未登记物流节点。</p>}</div>
    </section>
  </WorkbenchDialog></>;
}
