'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { WimoorReportFilters } from '@/components/wimoor-migration/wimoor-report-filters';
import { WimoorFeaturePanel } from '@/components/wimoor-migration/wimoor-feature-panel';

/**
 * WIMOOR「采购 → 采购管理 → 采购规划」对照入口。
 * 源组件：erp/purchase/plan_amz/index.vue
 * 还原点：筛选(滞销、运营中心转运/处理中、正在发货、待接收、正在接收、默认)
 *        / 下拉(系统默认) / 表格列(图片、名称·SKU、报表、公告、采购记录、可用库存、建议采购、
 *        实际采购量、操作、起订量、单价、订单、数量、状态、已付款、类型) / 按钮(关闭、确定)。
 * 本项目已有等价页：/purchase/plans → /operations/purchase-plans。
 * 筛选栏已用真实控件（采购状态/系统下拉）还原原版交互，数据由等价页提供，不造数。
 */
const COLUMNS = ['图片', '名称/SKU', '报表', '公告', '采购记录', '可用库存', '建议采购', '实际采购量', '操作', '起订量', '单价', '订单', '数量', '状态', '已付款', '类型'];
const ACTIONS = ['关闭', '确定'];
const EQUIVALENTS = [{ href: '/purchase/plans', label: '采购计划（等价页）' }];
const STATUS_OPTIONS = ['滞销', '运营中心转运', '运营中心处理中', '正在发货', '待接收', '正在接收', '默认'].map(v => ({ value: v, label: v }));

export default function WimoorPurchasePlanPage() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const filterConfig = useMemo(() => ({
    selectFilters: [
      { key: 'status', label: '采购状态', options: STATUS_OPTIONS, placeholder: '默认' },
      { key: 'system', label: '系统', options: [{ value: 'system-default', label: '系统默认' }], placeholder: '系统默认' },
    ],
    onFilterChange: setFilters,
  }), []);
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-6" data-wimoor-features="采购状态|系统|重置|刷新" data-active-filters={Object.values(filters).filter(Boolean).join('|')}>
      <WimoorFeaturePanel route="/wimoor/purchase/plan" />
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">采购规划 · WIMOOR 对照</h1>
        <p className="text-sm text-muted">源组件：erp/purchase/plan_amz/index.vue · 筛选栏按原版还原为真实控件；数据由等价页提供。</p>
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
      <p className="text-xs text-muted">说明：采购规划建议量由本项目等价页基于库存与销售数据计算，本页不造数、不重复实现。</p>
    </main>
  );
}
