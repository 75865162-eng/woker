'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { WimoorReportFilters } from '@/components/wimoor-migration/wimoor-report-filters';
import { WimoorFeaturePanel } from '@/components/wimoor-migration/wimoor-feature-panel';

/**
 * WIMOOR「采购 → 采购报表 → 采购时效」对照入口。
 * 源组件：erp/purchase/report/time/index.vue
 * 还原点：筛选(换货后库存) / 搜索维度(SKU) / 关键词 / 日期范围
 *        / 表格列(商品信息、订单号、时效、收货、换货、换货出库、盘点出库、出库、可用库存) / 按钮(导出)。
 * 本项目已有等价页：/purchase/logistics-quotes → /operations/logistics-quotes。
 * 筛选栏已用真实控件（日期/SKU搜索/换货后库存）还原原版交互，数据由等价页提供，不造数。
 */
const COLUMNS = ['商品信息', '订单号', '时效', '收货', '换货', '换货出库', '盘点出库', '出库', '可用库存'];
const ACTIONS = ['导出'];
const EQUIVALENTS = [{ href: '/purchase/logistics-quotes', label: '物流报价/采购报表（等价页）' }];
const STOCK_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'afterExchange', label: '换货后库存' },
  { value: 'available', label: '可用库存' },
];

export default function WimoorPurchaseTimePage() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const featurePanelBridge = useMemo(() => ({
    onSearch: (field: string, value: string) => setFilters(prev => ({ ...prev, [field]: value })),
    onSubmitSearch: (values: Record<string, string>) => setFilters(prev => ({ ...prev, ...values })),
    onResetSearch: () => setFilters({}),
  }), [setFilters]);
  const filterConfig = useMemo(() => ({
    dimensions: [{ key: 'sku', label: 'SKU', placeholder: '请输入SKU' }],
    keywordPlaceholder: '请输入',
    dateRange: true,
    dateLabels: ['开始日期', '结束日期'] as [string, string],
    selectFilters: [{ key: 'stockType', label: '库存维度', options: STOCK_OPTIONS, placeholder: '全部' }],
    onFilterChange: setFilters,
  }), []);
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-6" data-wimoor-features="库存维度|开始日期|结束日期|搜索维度|关键词|重置|刷新" data-active-filters={Object.values(filters).filter(Boolean).join('|')}>
      <WimoorFeaturePanel route="/wimoor/purchase/time" bridge={featurePanelBridge} />
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">采购时效 · WIMOOR 对照</h1>
        <p className="text-sm text-muted">源组件：erp/purchase/report/time/index.vue · 筛选栏按原版还原为真实控件；数据由等价页提供。</p>
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
      <p className="text-xs text-muted">说明：时效统计由本项目等价页承载，本页不造数、不重复实现导出。</p>
    </main>
  );
}
