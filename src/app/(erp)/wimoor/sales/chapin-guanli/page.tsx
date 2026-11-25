'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → 评论&绩效 → 差评管理」功能迁移。
 * 源组件：amazon/report/performance/orderfeedback/index.vue
 * 还原列口径：站点(marketname)、订单(amazon_order_id)、购买时间(purchase_date)、评论时间(feeddate)、
 * 产品(sku)、评星(rating)、评论(comments)、回复(response)、邮箱(email)。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /operations/reviews）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.negativeFeedback',
  title: '差评管理',
  subtitle: '等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /operations/reviews）：站点/订单/评星/评论/回复/邮箱',
  addLabel: '新增差评记录',
  searchPlaceholder: '订单号/SKU',
  columns: [
    { key: 'marketname', label: '站点', width: 110 },
    { key: 'amazon_order_id', label: '订单', width: 180 },
    { key: 'purchase_date', label: '购买时间', width: 150 },
    { key: 'feeddate', label: '评论时间', width: 150 },
    { key: 'sku', label: '产品', width: 150 },
    { key: 'rating', label: '评星', width: 90, numeric: true, render: (row) => <span className="text-warning-ink">{String(row.rating ?? '—')}★</span> },
    { key: 'comments', label: '评论', width: 240 },
    { key: 'response', label: '回复', width: 240 },
    { key: 'email', label: '邮箱', width: 180 },
  ],
  fields: [
    { key: 'amazon_order_id', label: '订单', required: true, placeholder: '请输入订单号' },
    { key: 'marketname', label: '站点', placeholder: '请输入站点' },
    { key: 'sku', label: '产品', placeholder: '请输入SKU' },
    { key: 'purchase_date', label: '购买时间', kind: 'date' },
    { key: 'feeddate', label: '评论时间', kind: 'date' },
    { key: 'rating', label: '评星', kind: 'number', defaultValue: '1' },
    { key: 'comments', label: '评论', placeholder: '请输入评论' },
    { key: 'response', label: '回复', placeholder: '请输入回复' },
    { key: 'email', label: '邮箱', placeholder: '请输入邮箱' },
  ],
};

export default function WimoorSalesNegativeFeedbackPage() {
  return <MasterDataWorkbench config={config} />;
}
