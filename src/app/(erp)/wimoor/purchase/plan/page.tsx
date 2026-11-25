'use client';
import Link from 'next/link';

/**
 * WIMOOR「采购 → 采购管理 → 采购规划」轻量对照入口。
 * 源组件：erp/purchase/plan_amz/index.vue
 * 还原点：筛选(滞销、运营中心转运/处理中、正在发货、待接收、正在接收、默认)
 *        / 下拉(系统默认) / 表格列(图片、名称·SKU、报表、公告、采购记录、可用库存、建议采购、
 *        实际采购量、操作、起订量、单价、订单、数量、状态、已付款、类型) / 按钮(关闭、确定)。
 * 本项目已有等价页：/purchase/plans → /operations/purchase-plans。本页只读对照，不重复实现采购算法。
 */
const FILTERS = ['滞销', '运营中心转运', '运营中心处理中', '正在发货', '待接收', '正在接收', '默认'];
const SELECTS = ['系统默认'];
const COLUMNS = ['图片', '名称/SKU', '报表', '公告', '采购记录', '可用库存', '建议采购', '实际采购量', '操作', '起订量', '单价', '订单', '数量', '状态', '已付款', '类型'];
const ACTIONS = ['关闭', '确定'];
const EQUIVALENTS = [{ href: '/purchase/plans', label: '采购计划（等价页）' }];

export default function WimoorPurchasePlanPage() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">采购规划 · WIMOOR 对照</h1>
        <p className="text-sm text-muted">源组件：erp/purchase/plan_amz/index.vue · 本页为只读对照入口，展示源页面筛选、列与按钮的还原映射。</p>
      </header>
      <section className="flex flex-wrap items-center gap-2 border border-border bg-surface p-3 text-sm">
        <span className="font-medium">等价入口</span>
        {EQUIVALENTS.map((item) => <Link key={item.href} href={item.href} className="text-info-ink underline">{item.label} →</Link>)}
      </section>
      <section className="flex flex-col gap-2 border border-border bg-surface p-3">
        <h2 className="text-sm font-medium">源页面筛选项</h2>
        <div className="flex flex-wrap gap-2">{FILTERS.map((f) => <span key={f} className="inline-flex rounded border border-border px-2 py-1 text-xs">{f}</span>)}</div>
        <div className="flex flex-wrap gap-2">{SELECTS.map((f) => <span key={f} className="inline-flex rounded bg-muted px-2 py-1 text-xs text-muted">下拉：{f}</span>)}</div>
      </section>
      <section className="border border-border bg-surface p-3">
        <h2 className="mb-2 text-sm font-medium">源页面表格列（只读对照）</h2>
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
