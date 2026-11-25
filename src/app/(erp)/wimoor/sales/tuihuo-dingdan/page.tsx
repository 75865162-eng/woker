'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → 订单管理 → 退货订单」功能迁移。
 * 源组件：amazon/order/refund/index.vue
 * 说明：源页面仅 58 行、无可提取筛选项/列/按钮，本项目已有完整退货管理页。
 * 等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/returns），承载退货单基础字段口径。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.returnOrders',
  title: '退货订单',
  subtitle: '等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/returns）',
  addLabel: '新增退货单',
  searchPlaceholder: '退货订单号',
  columns: [
    { key: 'returnId', label: '退货订单号', width: 180 },
    { key: 'orderId', label: '原订单号', width: 180 },
    { key: 'sku', label: 'SKU', width: 150 },
    { key: 'reason', label: '退货原因', width: 180 },
    { key: 'status', label: '状态', width: 100 },
    { key: 'refundAmount', label: '退款金额', width: 120, numeric: true },
    { key: 'applyDate', label: '申请时间', width: 150 },
  ],
  fields: [
    { key: 'returnId', label: '退货订单号', required: true, placeholder: '请输入退货订单号' },
    { key: 'orderId', label: '原订单号', placeholder: '请输入原订单号' },
    { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
    { key: 'reason', label: '退货原因', placeholder: '请输入退货原因' },
    { key: 'status', label: '状态', placeholder: '请输入状态' },
    { key: 'refundAmount', label: '退款金额', kind: 'number', defaultValue: '0' },
    { key: 'applyDate', label: '申请时间', kind: 'date' },
  ],
};

export default function WimoorSalesRefundPage() {
  return <MasterDataWorkbench config={config} />;
}
