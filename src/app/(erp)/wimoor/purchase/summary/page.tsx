'use client';
import Link from 'next/link';

/**
 * WIMOOR「采购 → 采购报表 → 采购统计」轻量对照入口。
 * 源组件：erp/purchase/report/summary/index.vue
 * 还原点：筛选(费用类型 ftypePlace) / 表格列(SKU、供应商、付款信息、入库信息) / 按钮(导出)。
 * 本项目已有等价页：/purchase/plans → /operations/purchase-plans。本页只读对照，不重复实现统计/导出。
 */
const FILTERS = ['费用类型（ftypePlace）'];
const SELECTS: string[] = [];
const COLUMNS = ['SKU', '供应商', '付款信息', '入库信息'];
const ACTIONS = ['导出'];
const EQUIVALENTS = [{ href: '/purchase/plans', label: '采购计划/统计（等价页）' }];

export default function WimoorPurchaseSummaryPage() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">采购统计 · WIMOOR 对照</h1>
        <p className="text-sm text-muted">源组件：erp/purchase/report/summary/index.vue · 本页为只读对照入口，展示源页面筛选、列与按钮的还原映射。</p>
      </header>
      <section className="flex flex-wrap items-center gap-2 border border-border bg-surface p-3 text-sm">
        <span className="font-medium">等价入口</span>
        {EQUIVALENTS.map((item) => <Link key={item.href} href={item.href} className="text-info-ink underline">{item.label} →</Link>)}
      </section>
      <section className="flex flex-col gap-2 border border-border bg-surface p-3">
        <h2 className="text-sm font-medium">源页面筛选项</h2>
        <div className="flex flex-wrap gap-2">{FILTERS.map((f) => <span key={f} className="inline-flex rounded border border-border px-2 py-1 text-xs">{f}</span>)}</div>
      </section>
      <section className="border border-border bg-surface p-3">
        <h2 className="mb-2 text-sm font-medium">源页面表格列（只读对照）</h2>
        <div className="flex flex-wrap gap-2">{COLUMNS.map((c) => <span key={c} className="inline-flex rounded border border-border px-2 py-1 text-xs">{c}</span>)}</div>
      </section>
      <section className="border border-border bg-surface p-3">
        <h2 className="mb-2 text-sm font-medium">源页面按钮</h2>
        <div className="flex flex-wrap gap-2">{ACTIONS.map((a) => <span key={a} className="inline-flex rounded border border-border px-2 py-1 text-xs">{a}</span>)}</div>
      </section>
      <p className="text-xs text-muted">说明：采购统计口径由本项目等价页承载，本页不造数、不重复实现导出。</p>
    </main>
  );
}
