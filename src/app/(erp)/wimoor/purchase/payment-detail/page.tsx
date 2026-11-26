'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { WimoorReportFilters } from '@/components/wimoor-migration/wimoor-report-filters';
import { WimoorFeaturePanel } from '@/components/wimoor-migration/wimoor-feature-panel';

/**
 * WIMOOR「采购 → 采购报表 → 采购付款明细」对照入口。
 * 源组件：erp/purchase/report/payment/index.vue
 * 还原点：筛选(付款账户、费用类型、关键词、日期) / 搜索维度(SKU、订单编号、付款备注、1688订单)
 *        / 表格列(订单编号、图片、名称·SKU、供应商、采购数量、采购金额、费用类型、付款金额、备注) / 按钮(导出)。
 * 本项目已有等价页：/operations/finance-ledger（财务台账）、/purchase/approvals。
 * 筛选栏已用真实控件（日期/付款账户/费用类型/搜索维度/关键词）还原原版交互，数据由等价页提供，不造数。
 */
const COLUMNS = ['订单编号', '图片', '名称/SKU', '供应商', '采购数量', '采购金额', '费用类型', '付款金额', '备注'];
const ACTIONS = ['导出'];
const EQUIVALENTS = [
  { href: '/operations/finance-ledger', label: '财务台账（等价页）' },
  { href: '/purchase/approvals', label: '审批中心（等价页）' },
];
const ACCOUNT_OPTIONS = [
  { value: '', label: '全部账户' },
  { value: '支付宝', label: '支付宝' },
  { value: '微信', label: '微信' },
  { value: '银行转账', label: '银行转账' },
];
const FEE_TYPE_OPTIONS = [
  { value: '', label: '全部费用类型' },
  { value: '货款', label: '货款' },
  { value: '运费', label: '运费' },
  { value: '其他', label: '其他' },
];

export default function WimoorPurchasePaymentDetailPage() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const filterConfig = useMemo(() => ({
    dimensions: [
      { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
      { key: 'orderNo', label: '订单编号', placeholder: '请输入订单编号' },
      { key: 'payRemark', label: '付款备注', placeholder: '请输入付款备注' },
      { key: 'order1688', label: '1688订单', placeholder: '请输入1688订单号' },
    ],
    keywordPlaceholder: '请输入',
    dateRange: true,
    dateLabels: ['付款日期起', '付款日期止'] as [string, string],
    selectFilters: [
      { key: 'account', label: '付款账户', options: ACCOUNT_OPTIONS, placeholder: '全部账户' },
      { key: 'feeType', label: '费用类型', options: FEE_TYPE_OPTIONS, placeholder: '全部费用类型' },
    ],
    onFilterChange: setFilters,
  }), []);
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-6" data-wimoor-features="付款账户|费用类型|付款日期起|付款日期止|搜索维度|关键词|重置|刷新" data-active-filters={Object.values(filters).filter(Boolean).join('|')}>
      <WimoorFeaturePanel route="/wimoor/purchase/payment-detail" />
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">采购付款明细 · WIMOOR 对照</h1>
        <p className="text-sm text-muted">源组件：erp/purchase/report/payment/index.vue · 筛选栏按原版还原为真实控件；数据由等价页提供。</p>
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
      <p className="text-xs text-muted">说明：付款流水由本项目等价页提供，本页不造数、不重复实现导出。</p>
    </main>
  );
}
