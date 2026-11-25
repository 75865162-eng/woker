'use client';
import Link from 'next/link';

/**
 * WIMOOR「采购 → 采购报表 → 采购时效」轻量对照入口。
 * 源组件：erp/purchase/report/time/index.vue
 * 还原点：筛选(换货后库存) / 搜索维度(SKU) / 关键词
 *        / 表格列(商品信息、订单号、时效、收货、换货、换货出库、盘点出库、出库、可用库存) / 按钮(导出)。
 * 本项目已有等价页：/purchase/logistics-quotes → /operations/logistics-quotes。本页只读对照。
 */
const FILTERS = ['换货后库存', '关键词（请输入）'];
const SELECTS = ['SKU'];
const COLUMNS = ['商品信息', '订单号', '时效', '收货', '换货', '换货出库', '盘点出库', '出库', '可用库存'];
const ACTIONS = ['导出'];
const EQUIVALENTS = [{ href: '/purchase/logistics-quotes', label: '物流报价/采购报表（等价页）' }];

export default function WimoorPurchaseTimePage() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">采购时效 · WIMOOR 对照</h1>
        <p className="text-sm text-muted">源组件：erp/purchase/report/time/index.vue · 本页为只读对照入口，展示源页面筛选、列与按钮的还原映射。</p>
      </header>
      <section className="flex flex-wrap items-center gap-2 border border-border bg-surface p-3 text-sm">
        <span className="font-medium">等价入口</span>
        {EQUIVALENTS.map((item) => <Link key={item.href} href={item.href} className="text-info-ink underline">{item.label} →</Link>)}
      </section>
      <section className="flex flex-col gap-2 border border-border bg-surface p-3">
        <h2 className="text-sm font-medium">源页面筛选项</h2>
        <div className="flex flex-wrap gap-2">{FILTERS.map((f) => <span key={f} className="inline-flex rounded border border-border px-2 py-1 text-xs">{f}</span>)}</div>
        <div className="flex flex-wrap gap-2">{SELECTS.map((f) => <span key={f} className="inline-flex rounded bg-muted px-2 py-1 text-xs text-muted">搜索维度：{f}</span>)}</div>
      </section>
      <section className="border border-border bg-surface p-3">
        <h2 className="mb-2 text-sm font-medium">源页面表格列（只读对照）</h2>
        <div className="flex flex-wrap gap-2">{COLUMNS.map((c) => <span key={c} className="inline-flex rounded border border-border px-2 py-1 text-xs">{c}</span>)}</div>
      </section>
      <section className="border border-border bg-surface p-3">
        <h2 className="mb-2 text-sm font-medium">源页面按钮</h2>
        <div className="flex flex-wrap gap-2">{ACTIONS.map((a) => <span key={a} className="inline-flex rounded border border-border px-2 py-1 text-xs">{a}</span>)}</div>
      </section>
      <p className="text-xs text-muted">说明：时效统计由本项目等价页承载，本页不造数、不重复实现导出。</p>
    </main>
  );
}
