'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { WimoorReportFilters } from '@/components/wimoor-migration/wimoor-report-filters';
import { WimoorFeaturePanel } from '@/components/wimoor-migration/wimoor-feature-panel';

/**
 * WIMOOR「采购 → 采购报表 → 采购统计」对照入口。
 * 源组件：erp/purchase/report/summary/index.vue
 * 还原点：筛选(费用类型 ftypePlace + 按SKU汇总/按供应商汇总) / 搜索维度(SKU/供应商)
 *        / 表格列(SKU、供应商、付款信息、入库信息) / 按钮(导出)。
 * 本项目已有等价页：/purchase/plans → /operations/purchase-plans。
 * 筛选栏已用真实控件（费用类型/汇总维度/搜索维度）还原原版交互，数据由等价页提供，不造数。
 */
const COLUMNS = ['SKU', '供应商', '付款信息', '入库信息'];
const ACTIONS = ['导出'];
const EQUIVALENTS = [{ href: '/purchase/plans', label: '采购计划/统计（等价页）' }];
const FEE_TYPE_OPTIONS = [
  { value: '', label: '全部费用类型' },
  { value: 'purchase', label: '采购货款' },
  { value: 'freight', label: '运费' },
  { value: 'other', label: '其它费用' },
];
const GROUP_OPTIONS = [
  { value: 'sku', label: '按SKU汇总' },
  { value: 'supplier', label: '按供应商汇总' },
];

export default function WimoorPurchaseSummaryPage() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const filterConfig = useMemo(() => ({
    dimensions: [
      { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
      { key: 'supplier', label: '供应商', placeholder: '请输入供应商' },
    ],
    keywordPlaceholder: '请输入',
    selectFilters: [
      { key: 'ftypePlace', label: '费用类型', options: FEE_TYPE_OPTIONS, placeholder: '全部费用类型' },
      { key: 'groupBy', label: '汇总方式', options: GROUP_OPTIONS, placeholder: '按SKU汇总' },
    ],
    onFilterChange: setFilters,
  }), []);
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-6" data-wimoor-features="费用类型|汇总方式|搜索维度|关键词|重置|刷新" data-active-filters={Object.values(filters).filter(Boolean).join('|')}>
      <WimoorFeaturePanel route="/wimoor/purchase/summary" />
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">采购统计 · WIMOOR 对照</h1>
        <p className="text-sm text-muted">源组件：erp/purchase/report/summary/index.vue · 筛选栏按原版还原为真实控件；数据由等价页提供。</p>
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
      <p className="text-xs text-muted">说明：采购统计口径由本项目等价页承载，本页不造数、不重复实现导出。</p>
    </main>
  );
}
