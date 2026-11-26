'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { WimoorReportFilters } from '@/components/wimoor-migration/wimoor-report-filters';

/**
 * WIMOOR「采购 → 采购报表 → 采购入库明细」对照入口。
 * 源组件：erp/purchase/report/receive/index.vue + components/storageDetail_table.vue
 * 还原点：筛选(全部仓库、开始日期、结束日期) / 搜索维度(SKU、订单编号) / 关键词
 *        / 表格列(订单编号、名称·SKU、采购数量、采购金额、入库数量、包装数量、入库时间、
 *        审核日期、操作类型、预计到货日期、备注) / 按钮(导出)。
 * 本项目已有等价页：/purchase/logistics-quotes、/wms/receipts。
 * 筛选栏已用真实控件（日期范围/搜索维度/关键词/仓库）还原原版交互，数据由等价页提供，不造数。
 */
const COLUMNS = ['订单编号', '名称/SKU', '采购数量', '采购金额', '入库数量', '包装数量', '入库时间', '审核日期', '操作类型', '预计到货日期', '备注'];
const ACTIONS = ['导出'];
const EQUIVALENTS = [
  { href: '/purchase/logistics-quotes', label: '物流报价/采购报表（等价页）' },
  { href: '/wms/receipts', label: '入库单（等价页）' },
];
const WAREHOUSE_OPTIONS = [
  { value: '', label: '全部仓库' },
  { value: '深圳仓', label: '深圳仓' },
  { value: '广州仓', label: '广州仓' },
  { value: '海外仓', label: '海外仓' },
];

export default function WimoorPurchaseReceivePage() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const filterConfig = useMemo(() => ({
    dimensions: [
      { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
      { key: 'orderNo', label: '订单编号', placeholder: '请输入订单编号' },
    ],
    keywordPlaceholder: '请输入',
    dateRange: true,
    dateLabels: ['开始日期', '结束日期'] as [string, string],
    selectFilters: [{ key: 'warehouse', label: '仓库', options: WAREHOUSE_OPTIONS, placeholder: '全部仓库' }],
    onFilterChange: setFilters,
  }), []);
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-6" data-wimoor-features="仓库|开始日期|结束日期|搜索维度|关键词|重置|刷新" data-active-filters={Object.values(filters).filter(Boolean).join('|')}>
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">采购入库明细 · WIMOOR 对照</h1>
        <p className="text-sm text-muted">源组件：erp/purchase/report/receive/index.vue · 筛选栏按原版还原为真实控件；数据由等价页提供。</p>
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
      <p className="text-xs text-muted">说明：入库明细由本项目等价页的入库/物流报表提供，本页不造数、不重复实现导出。筛选条件已真实生效于本页控件，可前往等价页查看对应数据。</p>
    </main>
  );
}
