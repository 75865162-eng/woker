'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { WimoorReportFilters } from '@/components/wimoor-migration/wimoor-report-filters';
import { WimoorFeaturePanel } from '@/components/wimoor-migration/wimoor-feature-panel';

/**
 * WIMOOR「采购 → 采购报表 → 采购详情」对照入口。
 * 源组件：erp/purchase/report/detail/index.vue
 * 还原点：搜索维度(SKU、订单编号、供应商名称) / 关键词 / 下单日期范围
 *        / 表格列(订单编号、下单日期、图片、SKU、供应商、采购单价、采购数量、采购金额、已付款金额、
 *        运费、入库数量、其它费用、预计到货时间、备注) / 按钮(导出)。
 * 本项目已有等价页：/purchase/orders → /operations?view=purchase-orders。
 * 筛选栏已用真实控件（日期/搜索维度/关键词）还原原版交互，数据由等价页提供，不造数。
 */
const COLUMNS = ['订单编号', '下单日期', '图片', 'SKU', '供应商', '采购单价', '采购数量', '采购金额', '已付款金额', '运费', '入库数量', '其它费用', '预计到货时间', '备注'];
const ACTIONS = ['导出'];
const EQUIVALENTS = [{ href: '/purchase/orders', label: '采购单（等价页）' }];

export default function WimoorPurchaseDetailPage() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const featurePanelBridge = useMemo(() => ({
    onSearch: (field: string, value: string) => setFilters(prev => ({ ...prev, [field]: value })),
    onSubmitSearch: (values: Record<string, string>) => setFilters(prev => ({ ...prev, ...values })),
    onResetSearch: () => setFilters({}),
  }), [setFilters]);
  const filterConfig = useMemo(() => ({
    dimensions: [
      { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
      { key: 'orderNo', label: '订单编号', placeholder: '请输入订单编号' },
      { key: 'supplier', label: '供应商名称', placeholder: '请输入供应商名称' },
    ],
    keywordPlaceholder: '请输入',
    dateRange: true,
    dateLabels: ['下单日期起', '下单日期止'] as [string, string],
    onFilterChange: setFilters,
  }), []);
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-6" data-wimoor-features="下单日期起|下单日期止|搜索维度|关键词|重置|刷新" data-active-filters={Object.values(filters).filter(Boolean).join('|')}>
      <WimoorFeaturePanel route="/wimoor/purchase/detail" bridge={featurePanelBridge} />
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">采购详情 · WIMOOR 对照</h1>
        <p className="text-sm text-muted">源组件：erp/purchase/report/detail/index.vue · 筛选栏按原版还原为真实控件；数据由等价页提供。</p>
      </header>
      <WimoorReportFilters config={filterConfig} />
      <section className="flex flex-wrap items-center gap-2 border border-border bg-surface p-3 text-sm">
        <span className="font-medium">等价入口</span>
        {EQUIVALENTS.map((item) => <Link key={item.href} href={item.href} className="text-info-ink underline">{item.label} →</Link>)}
      </section>
      <section className="border border-border bg-surface p-3">
        <h2 className="mb-2 text-sm font-medium">源页面表格列（对照）</h2>
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
