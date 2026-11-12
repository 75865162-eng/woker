"use client";

import { useState } from "react";
import { operationsEntries, OperationsSectionGuide } from "./operations-sections";

// Adapted layout references: Wimoor finance/paymentRequest.
// Copyright (c) 2022 深圳市万墨信息科技有限公司 — MIT, public/licenses/wimoor-MIT.txt.
const layouts: Record<string, { tabs: string[]; columns: string[]; source: string; gaps: string[]; links: Array<[string, string]> }> = {
  "expense-management": { tabs: ["全部订单", "待审核", "待付款", "已完成", "已驳回"], columns: ["请款单号", "关联单号", "付款方式", "状态", "申请金额 / 币种", "申请人", "申请日期", "审核人", "审核日期", "备注"], source: "erp/finance/paymentRequest/index.vue、components/table.vue", gaps: ["API：通用 ERP 费用单、凭证和请款查询未接入；采购付款与 FBA 费用保留各自入口", "Service：通用费用审批、会计关联和核销缺失", "模型：通用费用单、报销、付款关联聚合缺失；现有 PurchasePayment / FbaLocalFee 不代表通用费用单"], links: [["/operations?view=purchase-orders", "采购付款与对账"], ["/operations?view=first-mile", "头程费用与货代账单"], ["/operations?view=finance", "Amazon 已发布财务交易"], ["/operations?view=settlements", "Amazon 结算报告"]] },
};

export function UnconnectedBusinessWorkbench({ view }: { view: string }) {
  const [tab, setTab] = useState(0);
  const layout = layouts[view];
  const entry = operationsEntries.find(item => item.view === view);
  if (!layout) return <OperationsSectionGuide view={view} />;
  return <section className="space-y-4 rounded-lg border border-border bg-surface p-4" aria-label={entry?.label}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">{entry?.label}</h2><span role="status" className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">后端未接入 · 布局预览</span></div>
    <div role="tablist" aria-label="业务视图" className="flex flex-wrap gap-2 border-b border-border">{layout.tabs.map((label, index) => <button type="button" role="tab" key={label} aria-selected={tab === index} onClick={() => setTab(index)} className={"min-h-9 border-b-2 px-3 text-sm " + (tab === index ? "border-brand font-semibold" : "border-transparent text-muted")}>{label}</button>)}</div>
    <p className="text-xs text-muted">{layout.tabs[tab]}：尚无可查询的业务接口，筛选、创建、导入和提交暂不可用。</p>
    <fieldset disabled aria-label="请款筛选（未接入）" className="flex flex-wrap gap-3 rounded border border-border bg-surface-muted/40 p-3 opacity-70">
      <legend className="px-1 text-xs text-muted">筛选布局 · 未接入</legend>
      <label className="grid gap-1 text-xs">供应商<select aria-label="供应商" className="h-9 rounded border border-border bg-surface px-2"><option>全部供应商</option></select></label>
      <label className="grid gap-1 text-xs">付款方式<select aria-label="付款方式" className="h-9 rounded border border-border bg-surface px-2"><option>全部付款方式</option></select></label>
      <label className="grid gap-1 text-xs">日期类型<select aria-label="日期类型" className="h-9 rounded border border-border bg-surface px-2"><option>申请日期</option><option>预计付款日期</option><option>实际付款日期</option></select></label>
      <label className="grid gap-1 text-xs">开始日期<input aria-label="开始日期" type="date" className="h-9 rounded border border-border bg-surface px-2" /></label>
      <label className="grid gap-1 text-xs">结束日期<input aria-label="结束日期" type="date" className="h-9 rounded border border-border bg-surface px-2" /></label>
      <label className="grid gap-1 text-xs">单号搜索<input aria-label="单号搜索" placeholder="请款单号 / 关联单号" className="h-9 rounded border border-border bg-surface px-2" /></label>
    </fieldset>
    <div className="overflow-auto rounded border border-border"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-surface-muted"><tr>{layout.columns.map(label => <th key={label} className="px-3 py-3 font-medium">{label}</th>)}</tr></thead><tbody><tr><td colSpan={layout.columns.length} className="p-10 text-center text-muted">业务数据未接入；此处不代表查询成功或业务记录为空。</td></tr></tbody></table></div>
    <details className="rounded border border-border p-3 text-xs"><summary className="cursor-pointer font-medium">接入缺口与布局来源</summary><ul className="mt-3 space-y-2">{layout.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul><p className="mt-3 text-muted">Wimoor：{layout.source}</p></details>
    <div className="flex flex-wrap gap-4">{layout.links.map(([href, label]) => <a key={href} href={href} className="text-xs font-medium text-brand hover:underline">{label} →</a>)}</div>
  </section>;
}
