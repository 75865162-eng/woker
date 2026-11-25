'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → listing → 销售报表」功能迁移。
 * 源组件：amazon/sales/report/index.vue
 * 还原交互：搜索(请输入SKU) / 更多条件筛选：销售渠道、配送方式、客户类型、促销订单、折扣金额占原价、订单状态。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /sellfox/sales），承载核心列与筛选口径。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.salesReport',
  title: '销售报表',
  subtitle: '等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /sellfox/sales）：销售渠道/配送方式/客户类型/促销订单/折扣/订单状态',
  addLabel: '新增报表记录',
  searchPlaceholder: '请输入SKU',
  columns: [
    { key: 'sku', label: 'SKU', width: 160 },
    { key: 'name', label: '商品名称', width: 200 },
    { key: 'salesChannel', label: '销售渠道', width: 120 },
    { key: 'fulfillment', label: '配送方式', width: 120 },
    { key: 'customerType', label: '客户类型', width: 110 },
    { key: 'promotionOrder', label: '促销订单', width: 100 },
    { key: 'discountRate', label: '折扣金额占原价', width: 140 },
    { key: 'orderStatus', label: '订单状态', width: 110 },
  ],
  fields: [
    { key: 'sku', label: 'SKU', required: true, placeholder: '请输入SKU' },
    { key: 'name', label: '商品名称', placeholder: '请输入商品名称' },
    { key: 'salesChannel', label: '销售渠道', placeholder: '请输入销售渠道' },
    { key: 'fulfillment', label: '配送方式', placeholder: '请输入配送方式' },
    { key: 'customerType', label: '客户类型', placeholder: '请输入客户类型' },
    { key: 'promotionOrder', label: '促销订单', placeholder: '请输入促销订单' },
    { key: 'discountRate', label: '折扣金额占原价', placeholder: '请输入折扣金额占原价' },
    { key: 'orderStatus', label: '订单状态', placeholder: '请输入订单状态' },
  ],
  extraFilters: [
    { key: 'salesChannel', label: '销售渠道', placeholder: '销售渠道' },
    { key: 'fulfillment', label: '配送方式', placeholder: '配送方式' },
    { key: 'customerType', label: '客户类型', placeholder: '客户类型' },
    { key: 'promotionOrder', label: '促销订单', placeholder: '促销订单' },
    { key: 'discountRate', label: '折扣金额占原价', placeholder: '折扣金额占原价' },
    { key: 'orderStatus', label: '订单状态', placeholder: '订单状态' },
  ],
};

export default function WimoorSalesReportPage() {
  return <MasterDataWorkbench config={config} />;
}
