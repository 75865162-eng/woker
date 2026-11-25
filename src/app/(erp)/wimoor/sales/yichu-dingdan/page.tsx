'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → 订单管理 → 移除订单」功能迁移。
 * 源组件：amazon/order/remove/index.vue
 * 说明：源页面仅 25 行（空壳组件），本项目已有完整移除订单报告页。
 * 等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/removal-order-report）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.removalOrders',
  title: '移除订单',
  subtitle: '等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/removal-order-report）',
  addLabel: '新增移除订单',
  searchPlaceholder: '移除订单号',
  columns: [
    { key: 'removalId', label: '移除订单号', width: 180 },
    { key: 'sku', label: 'SKU', width: 160 },
    { key: 'quantity', label: '数量', width: 100, numeric: true },
    { key: 'reason', label: '移除原因', width: 180 },
    { key: 'status', label: '状态', width: 110 },
    { key: 'createdAt', label: '创建时间', width: 150 },
  ],
  fields: [
    { key: 'removalId', label: '移除订单号', required: true, placeholder: '请输入移除订单号' },
    { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
    { key: 'quantity', label: '数量', kind: 'number', defaultValue: '0' },
    { key: 'reason', label: '移除原因', placeholder: '请输入移除原因' },
    { key: 'status', label: '状态', placeholder: '请输入状态' },
    { key: 'createdAt', label: '创建时间', kind: 'date' },
  ],
};

export default function WimoorSalesRemovalOrdersPage() {
  return <MasterDataWorkbench config={config} />;
}
