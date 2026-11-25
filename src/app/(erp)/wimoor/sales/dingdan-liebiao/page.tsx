'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → 订单管理 → 订单列表」功能迁移。
 * 源组件：amazon/order/order_manager/index.vue
 * 说明：源页面仅 15 行（空壳组件），本项目已有完整订单管理页。
 * 等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/orders），承载订单基础字段口径。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.orderList',
  title: '订单列表',
  subtitle: '等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/orders）',
  addLabel: '新增订单',
  searchPlaceholder: '订单号',
  columns: [
    { key: 'orderId', label: '订单号', width: 180 },
    { key: 'sku', label: '商品SKU', width: 160 },
    { key: 'name', label: '商品名称', width: 200 },
    { key: 'site', label: '站点', width: 110 },
    { key: 'status', label: '订单状态', width: 110 },
    { key: 'purchaseDate', label: '购买时间', width: 160 },
    { key: 'amount', label: '订单金额', width: 120, numeric: true },
  ],
  fields: [
    { key: 'orderId', label: '订单号', required: true, placeholder: '请输入订单号' },
    { key: 'sku', label: '商品SKU', placeholder: '请输入商品SKU' },
    { key: 'name', label: '商品名称', placeholder: '请输入商品名称' },
    { key: 'site', label: '站点', placeholder: '请输入站点' },
    { key: 'status', label: '订单状态', placeholder: '请输入订单状态' },
    { key: 'purchaseDate', label: '购买时间', kind: 'date' },
    { key: 'amount', label: '订单金额', kind: 'number', defaultValue: '0' },
  ],
};

export default function WimoorSalesOrderListPage() {
  return <MasterDataWorkbench config={config} />;
}
