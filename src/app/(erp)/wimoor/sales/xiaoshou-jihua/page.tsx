'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → listing → 销售计划」功能迁移。
 * 源组件：amazon/sales/forecast/index.vue
 * 还原交互：搜索(SKU/MSKU/ASIN)、开始上架日期/结束上架日期 / 重置 / 导出 / 导入 / 批量保存 / 保存 / 详细计划 / 分页。
 * 列：图片、名称/SKU、店铺/国家、本地库存、销量、日均、7天、30天、上架时间、销量预测、三个月份预测列。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/sales-plans）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.salesPlan',
  title: '销售计划',
  subtitle: '等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/sales-plans）：本地库存/销量/日均/7天/30天/销量预测/月度计划',
  addLabel: '新增销售计划',
  searchPlaceholder: '请输入 SKU',
  columns: [
    { key: 'img', label: '图片', width: 70, render: (row) => row.img
      ? <img src={String(row.img)} alt="商品图片" className="h-10 w-10 object-cover" />
      : <span className="text-muted">—</span> },
    { key: 'sku', label: '名称/SKU', width: 200 },
    { key: 'groupname', label: '店铺/国家', width: 140 },
    { key: 'fulfillable', label: '本地库存', width: 100, numeric: true },
    { key: 'state', label: '销量', width: 90, numeric: true },
    { key: 'avgsales', label: '日均', width: 90, numeric: true },
    { key: 'sumseven', label: '7天', width: 90, numeric: true },
    { key: 'summonth', label: '30天', width: 90, numeric: true },
    { key: 'openDate', label: '上架时间', width: 120 },
    { key: 'operator', label: '销量预测', width: 100, numeric: true },
    { key: 'month1', label: '第1月', width: 90, numeric: true },
    { key: 'month2', label: '第2月', width: 90, numeric: true },
    { key: 'month3', label: '第3月', width: 90, numeric: true },
  ],
  fields: [
    { key: 'sku', label: 'SKU', required: true, placeholder: '请输入 SKU' },
    { key: 'name', label: '商品名称', placeholder: '请输入商品名称' },
    { key: 'img', label: '图片地址', placeholder: '请输入图片地址' },
    { key: 'groupname', label: '店铺/国家', placeholder: '请输入店铺/国家' },
    { key: 'fulfillable', label: '本地库存', kind: 'number', defaultValue: '0' },
    { key: 'state', label: '销量', kind: 'number', defaultValue: '0' },
    { key: 'avgsales', label: '日均', kind: 'number', defaultValue: '0' },
    { key: 'sumseven', label: '7天', kind: 'number', defaultValue: '0' },
    { key: 'summonth', label: '30天', kind: 'number', defaultValue: '0' },
    { key: 'openDate', label: '上架时间', kind: 'date' },
    { key: 'operator', label: '销量预测', kind: 'number', defaultValue: '0' },
    { key: 'month1', label: '第1月', kind: 'number', defaultValue: '0' },
    { key: 'month2', label: '第2月', kind: 'number', defaultValue: '0' },
    { key: 'month3', label: '第3月', kind: 'number', defaultValue: '0' },
  ],
  extraFilters: [
    { key: 'searchType', label: '搜索类型', kind: 'select', defaultValue: 'SKU',
      options: [{ value: 'SKU', label: 'SKU' }, { value: 'MSKU', label: 'MSKU' }, { value: 'ASIN', label: 'ASIN' }],
    },
    { key: 'startDate', label: '开始上架日期', kind: 'date' },
    { key: 'endDate', label: '结束上架日期', kind: 'date' },
  ],
};

export default function WimoorSalesForecastPage() {
  return <MasterDataWorkbench config={config} />;
}
