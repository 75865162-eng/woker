'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → listing → 销量详情」功能迁移。
 * 源组件：amazon/sales/details/index.vue
 * 还原交互：搜索(请输入SKU) / 汇总维度(按日汇总、按周汇总、按月汇总) / 指标(销量、订单) / 导出 / 分页。
 * 列：图片(img)、名称/MSKU(sku)、上架日期(openDate)、汇总(vsum)。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /sellfox/order-detail）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.salesDetails',
  title: '销量详情',
  subtitle: '等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /sellfox/order-detail）：图片/名称MSKU/上架日期/汇总',
  addLabel: '新增销量记录',
  searchPlaceholder: '请输入SKU',
  columns: [
    { key: 'img', label: '图片', width: 70, render: (row) => row.img
      ? <img src={String(row.img)} alt="商品图片" className="h-10 w-10 object-cover" />
      : <span className="text-muted">—</span> },
    { key: 'sku', label: '名称/MSKU', width: 220 },
    { key: 'openDate', label: '上架日期', width: 130 },
    { key: 'vsum', label: '汇总', width: 120, numeric: true },
  ],
  fields: [
    { key: 'sku', label: '名称/MSKU', required: true, placeholder: '请输入SKU' },
    { key: 'img', label: '图片地址', placeholder: '请输入图片地址' },
    { key: 'openDate', label: '上架日期', kind: 'date' },
    { key: 'vsum', label: '汇总', kind: 'number', defaultValue: '0' },
  ],
  extraFilters: [
    { key: 'summaryType', label: '汇总维度', kind: 'select', defaultValue: '按日汇总',
      options: [
        { value: '按日汇总', label: '按日汇总' }, { value: '按周汇总', label: '按周汇总' },
        { value: '按月汇总', label: '按月汇总' },
      ],
    },
    { key: 'metric', label: '指标', kind: 'select', defaultValue: '销量',
      options: [{ value: '销量', label: '销量' }, { value: '订单', label: '订单' }],
    },
  ],
};

export default function WimoorSalesDetailsPage() {
  return <MasterDataWorkbench config={config} />;
}
