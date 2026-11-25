'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → FBA报表 → 流量报表」功能迁移（新增页）。
 * 源组件：amazon/report/pageview/index.vue
 * 还原交互：店铺选择 / 日期筛选 / 搜索(请输入SKU) / 分页。
 * 列：图片(image)、SKU(名称+SKU)、日期(byday)、访问次数(sessions)、访问转化率(sessionPercentage%)、
 * 浏览次数(pageViews)、浏览转化率(pageViewsPercentage%)、购物车比例(buyBoxPercentage%)、
 * 销量(unitsOrdered + B2B)、商品转化率(unitSessionPercentage% + B2B)、
 * 销售额(orderedProductSales + B2B)、订单(totalOrderItems + B2B)。
 */
const pct = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : `${String(v)}%`);
const withB2B = (v: unknown, b2b: unknown) => (
  <span className="flex flex-col">
    <span>{v === null || v === undefined || v === '' ? '—' : String(v)}</span>
    {b2b !== null && b2b !== undefined && b2b !== '' ? <span className="text-muted">B2B:{String(b2b)}</span> : null}
  </span>
);
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.trafficReport',
  title: '流量报表',
  subtitle: 'WIMOOR 流量报表迁移：访问/浏览/购物车比例/销量/转化率/销售额/订单，含 B2B 明细口径',
  addLabel: '新增流量记录',
  searchPlaceholder: '请输入SKU',
  columns: [
    { key: 'image', label: '图片', width: 70, render: (row) => row.image
      ? <img src={String(row.image)} alt="商品图片" className="h-10 w-10 object-cover" />
      : <span className="text-muted">—</span> },
    { key: 'sku', label: 'SKU', width: 200, render: (row) => (
      <span className="flex flex-col"><span>{String(row.name ?? '—')}</span><span className="text-muted">SKU:{String(row.sku ?? '')}</span></span>
    ) },
    { key: 'byday', label: '日期', width: 130 },
    { key: 'sessions', label: '访问次数', width: 110, numeric: true },
    { key: 'sessionPercentage', label: '访问转化率', width: 110, render: (row) => <span>{pct(row.sessionPercentage)}</span> },
    { key: 'pageViews', label: '浏览次数', width: 110, numeric: true },
    { key: 'pageViewsPercentage', label: '浏览转化率', width: 110, render: (row) => <span>{pct(row.pageViewsPercentage)}</span> },
    { key: 'buyBoxPercentage', label: '购物车比例', width: 110, render: (row) => <span>{pct(row.buyBoxPercentage)}</span> },
    { key: 'unitsOrdered', label: '销量', width: 110, numeric: true, render: (row) => withB2B(row.unitsOrdered, row.unitsOrderedB2B) },
    { key: 'unitSessionPercentage', label: '商品转化率', width: 120, render: (row) => withB2B(pct(row.unitSessionPercentage), row.unitSessionPercentageB2B === undefined || row.unitSessionPercentageB2B === '' ? null : `${String(row.unitSessionPercentageB2B)}%`) },
    { key: 'orderedProductSales', label: '销售额', width: 120, numeric: true, render: (row) => withB2B(row.orderedProductSales, row.orderedProductSalesB2B) },
    { key: 'totalOrderItems', label: '订单', width: 110, numeric: true, render: (row) => withB2B(row.totalOrderItems, row.totalOrderItemsB2B) },
  ],
  fields: [
    { key: 'sku', label: 'SKU', required: true, placeholder: '请输入 SKU' },
    { key: 'name', label: '商品名称', placeholder: '请输入商品名称' },
    { key: 'image', label: '图片地址', placeholder: '请输入图片地址' },
    { key: 'byday', label: '日期', kind: 'date' },
    { key: 'sessions', label: '访问次数', kind: 'number', defaultValue: '0' },
    { key: 'sessionPercentage', label: '访问转化率(%)', kind: 'number', defaultValue: '0' },
    { key: 'pageViews', label: '浏览次数', kind: 'number', defaultValue: '0' },
    { key: 'pageViewsPercentage', label: '浏览转化率(%)', kind: 'number', defaultValue: '0' },
    { key: 'buyBoxPercentage', label: '购物车比例(%)', kind: 'number', defaultValue: '0' },
    { key: 'unitsOrdered', label: '销量', kind: 'number', defaultValue: '0' },
    { key: 'unitsOrderedB2B', label: '销量-B2B', kind: 'number', defaultValue: '0' },
    { key: 'unitSessionPercentage', label: '商品转化率(%)', kind: 'number', defaultValue: '0' },
    { key: 'unitSessionPercentageB2B', label: '商品转化率(%)-B2B', kind: 'number', defaultValue: '0' },
    { key: 'orderedProductSales', label: '销售额', kind: 'number', defaultValue: '0' },
    { key: 'orderedProductSalesB2B', label: '销售额-B2B', kind: 'number', defaultValue: '0' },
    { key: 'totalOrderItems', label: '订单', kind: 'number', defaultValue: '0' },
    { key: 'totalOrderItemsB2B', label: '订单-B2B', kind: 'number', defaultValue: '0' },
  ],
  extraFilters: [
    { key: 'startDate', label: '开始日期', kind: 'date' },
    { key: 'endDate', label: '结束日期', kind: 'date' },
  ],
};

export default function WimoorSalesTrafficReportPage() {
  return <MasterDataWorkbench config={config} />;
}
