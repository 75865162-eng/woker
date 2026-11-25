'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → 订单管理 → 今日订单」功能迁移。
 * 源组件：amazon/order/today/index.vue
 * 还原交互：导出 / 分页；表格按「今日 / 昨日 / 上周同日 / 库存」四组对照展示。
 * 列：图片、商品信息、今日(销量QuantityOrdered/净销售额total_price/单价price)、
 * 昨日(QuantityOrdered_yy/totalprice_yy/price_yy)、上周同日(QuantityOrdered_lw/totalprice_lw/price_lw)、
 * 库存(可售fulfillable/待收货inbound/预留reserved)。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /operations/today-orders）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.todayOrders',
  title: '今日订单',
  subtitle: '等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /operations/today-orders）：今日/昨日/上周同日/库存对照',
  addLabel: '新增今日订单记录',
  searchPlaceholder: '商品信息/SKU',
  columns: [
    { key: 'img', label: '图片', width: 70, render: (row) => row.img
      ? <img src={String(row.img)} alt="商品图片" className="h-10 w-10 object-cover" />
      : <span className="text-muted">—</span> },
    { key: 'product', label: '商品信息', width: 200 },
    { key: 'QuantityOrdered', label: '今日-销量', width: 100, numeric: true },
    { key: 'total_price', label: '今日-净销售额', width: 120, numeric: true },
    { key: 'price', label: '今日-单价', width: 100, numeric: true },
    { key: 'QuantityOrdered_yy', label: '昨日-销量', width: 100, numeric: true },
    { key: 'totalprice_yy', label: '昨日-净销售额', width: 120, numeric: true },
    { key: 'price_yy', label: '昨日-单价', width: 100, numeric: true },
    { key: 'QuantityOrdered_lw', label: '上周同日-销量', width: 120, numeric: true },
    { key: 'totalprice_lw', label: '上周同日-净销售额', width: 130, numeric: true },
    { key: 'price_lw', label: '上周同日-单价', width: 110, numeric: true },
    { key: 'fulfillable', label: '库存-可售', width: 100, numeric: true },
    { key: 'inbound', label: '库存-待收货', width: 110, numeric: true },
    { key: 'reserved', label: '库存-预留', width: 100, numeric: true },
  ],
  fields: [
    { key: 'product', label: '商品信息', required: true, placeholder: '请输入商品信息' },
    { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
    { key: 'img', label: '图片地址', placeholder: '请输入图片地址' },
    { key: 'QuantityOrdered', label: '今日-销量', kind: 'number', defaultValue: '0' },
    { key: 'total_price', label: '今日-净销售额', kind: 'number', defaultValue: '0' },
    { key: 'price', label: '今日-单价', kind: 'number', defaultValue: '0' },
    { key: 'QuantityOrdered_yy', label: '昨日-销量', kind: 'number', defaultValue: '0' },
    { key: 'totalprice_yy', label: '昨日-净销售额', kind: 'number', defaultValue: '0' },
    { key: 'price_yy', label: '昨日-单价', kind: 'number', defaultValue: '0' },
    { key: 'QuantityOrdered_lw', label: '上周同日-销量', kind: 'number', defaultValue: '0' },
    { key: 'totalprice_lw', label: '上周同日-净销售额', kind: 'number', defaultValue: '0' },
    { key: 'price_lw', label: '上周同日-单价', kind: 'number', defaultValue: '0' },
    { key: 'fulfillable', label: '库存-可售', kind: 'number', defaultValue: '0' },
    { key: 'inbound', label: '库存-待收货', kind: 'number', defaultValue: '0' },
    { key: 'reserved', label: '库存-预留', kind: 'number', defaultValue: '0' },
  ],
};

export default function WimoorSalesTodayOrdersPage() {
  return <MasterDataWorkbench config={config} />;
}
