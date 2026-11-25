'use client';
import Link from 'next/link';

/**
 * WIMOOR「采购 → 采购报表 → 采购详情」轻量对照入口。
 * 源组件：erp/purchase/report/detail/index.vue
 * 还原点：搜索维度(SKU、订单编号、供应商名称) / 关键词
 *        / 表格列(订单编号、下单日期、图片、SKU、供应商、采购单价、采购数量、采购金额、已付款金额、
 *        运费、入库数量、其它费用、预计到货时间、备注) / 按钮(导出)。
 * 本项目已有等价页：/purchase/orders → /operations?view=purchase-orders。本页只读对照。
 */
const FILTERS = ['关键词（请输入）'];
const SELECTS = ['SKU', '订单编号', '供应商名称'];
const COLUMNS = ['订单编号', '下单日期', '图片', 'SKU', '供应商', '采购单价', '采购数量', '采购金额', '已付款金额', '运费', '入库数量', '其它费用', '预计到货时间', '备注'];
const ACTIONS = ['导出'];
const EQUIVALENTS = [{ href: '/purchase/orders', label: '采购单（等价页）' }];

export default function WimoorPurchaseDetailPage() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">采购详情 · WIMOOR 对照</h1>
        <p className="text-sm text-muted">源组件：erp/purchase/report/detail/index.vue · 本页为只读对照入口，展示源页面筛选、列与按钮的还原映射。</p>
      </header>
      <section className="flex flex-wrap items-center gap-2 border border-border bg-surface p-3 text-sm">
        <span className="font-medium">等价入口</span>
        {EQUIVALENTS.map((item) => <Link key={item.href} href={item.href} className="text-info-ink underline">{item.label} →</Link>)}
      </section>
      <section className="flex flex-col gap-2 border border-border bg-surface p-3">
        <h2 className="text-sm font-medium">源页面筛选项</h2>
        <div className="flex flex-wrap gap-2">{FILTERS.map((f) => <span key={f} className="inline-flex rounded border border-border px-2 py-1 text-xs">{f}</span>)}</div>
        <div className="flex flex-wrap gap-2">{SELECTS.map((f) => <span key={f} className="inline-flex rounded bg-surface-muted px-2 py-1 text-xs text-muted">搜索维度：{f}</span>)}</div>
      </section>
      <section className="border border-border bg-surface p-3">
        <h2 className="mb-2 text-sm font-medium">源页面表格列（只读对照）</h2>
        <div className="flex flex-wrap gap-2">{COLUMNS.map((c) => <span key={c} className="inline-flex rounded border border-border px-2 py-1 text-xs">{c}</span>)}</div>
      </section>
      <section className="border border-border bg-surface p-3">
        <h2 className="mb-2 text-sm font-medium">源页面按钮</h2>
        <div className="flex flex-wrap gap-2">{ACTIONS.map((a) => <span key={a} className="inline-flex rounded border border-border px-2 py-1 text-xs">{a}</span>)}</div>
      </section>
      <p className="text-xs text-muted">说明：采购明细数据由等价页采购单/报表提供，本页不造数、不重复实现导出。</p>
    </main>
  );
}
