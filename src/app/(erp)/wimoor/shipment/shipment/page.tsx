'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「发货 → 发货管理 → 发货单」功能迁移。
 * 源组件：erp/shipv2/shipment_add/list/index.vue + components/header.vue + components/table.vue
 * 还原交互：状态页签(全部订单/待审核/已保持/待配货/计划装箱/配送方案确认/货件装箱/物流确认/发货出库/货件跟踪/已取消/已驳回) /
 *          店铺·仓库·日期筛选 / SKU·计划名称·计划编码·备注搜索类型 / 重置 / 添加新版货件 / 同步计划 /
 *          打印配货单(简单版·详细版) / 批量下架 / 解除保持；
 *          表格还原店铺、计划编码、SKU个数、发货数量、发货仓库、收货站点、申请/审核日期、状态、备注。
 */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: '全部订单', PENDING: '待审核', PICKING: '仓库配货', BOXING: '计划装箱',
  CONFIRMING: '配送方案确认', LABELING: '货件装箱', LOGISTICS: '物流确认',
  SHIPPED: '发货出库', TRACKING: '货件跟踪', HELD: '已保持', CANCELLED: '已取消', REJECTED: '已驳回',
};

const config: MasterDataWorkbenchConfig = {
  kind: 'shipment.shipment',
  type: 'document',
  title: '发货单',
  subtitle: 'WIMOOR 发货单功能迁移：计划编码、店铺仓库、SKU/发货数量与发货状态流转（用户显式创建才有数据）',
  addLabel: '添加新版货件',
  searchPlaceholder: '请输入SKU/计划名称/计划编码/备注',
  columns: [
    { key: 'docNo', label: '计划编码', width: 180 },
    { key: 'name', label: '计划名称', width: 160 },
    { key: 'groupname', label: '店铺', width: 130 },
    { key: 'skunum', label: 'SKU个数', width: 100, numeric: true },
    { key: 'sumquantity', label: '发货数量', width: 110, numeric: true },
    { key: 'warename', label: '发货仓库', width: 160 },
    { key: 'countryname', label: '收货站点', width: 140 },
    { key: 'createtime', label: '申请日期', width: 160 },
    { key: 'auditime', label: '审核日期', width: 160 },
    {
      key: 'status', label: '状态', width: 130,
      render: (row) => <span className="text-muted">{STATUS_LABELS[String(row.status ?? 'DRAFT')] ?? String(row.status ?? 'DRAFT')}</span>,
    },
    { key: 'remark', label: '备注', width: 180 },
  ],
  fields: [
    { key: 'docNo', label: '计划编码', required: true, placeholder: '请输入计划编码' },
    { key: 'name', label: '计划名称', placeholder: '请输入计划名称' },
    { key: 'groupname', label: '店铺', placeholder: '请选择店铺' },
    { key: 'marketplaceid', label: '站点', placeholder: '请选择站点' },
    { key: 'warehouseid', label: '发货仓库', placeholder: '请选择发货仓库' },
    { key: 'country', label: '收货站点', placeholder: '请输入收货站点' },
    { key: 'skunum', label: 'SKU个数', kind: 'number', defaultValue: '0' },
    { key: 'sumquantity', label: '发货数量', kind: 'number', defaultValue: '0' },
    { key: 'transtypename', label: '运输方式', placeholder: '请输入运输方式' },
    { key: 'createtime', label: '申请日期', kind: 'date' },
    { key: 'auditime', label: '审核日期', kind: 'date' },
    { key: 'shippingDate', label: '发货日期', kind: 'date' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'PENDING',
      options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
    },
  ],
  extraFilters: [
    { key: 'seachtype', label: '搜索类型', kind: 'select', defaultValue: 'sku',
      options: [
        { value: 'sku', label: 'SKU' }, { value: 'plan', label: '计划名称' },
        { value: 'number', label: '计划编码' }, { value: 'remark', label: '备注' },
      ],
    },
    { key: 'groupname', label: '店铺', placeholder: '请选择店铺' },
    { key: 'warehouseid', label: '发货仓库', placeholder: '请选择仓库' },
    { key: 'start', label: '开始日期', kind: 'date' },
    { key: 'end', label: '结束日期', kind: 'date' },
  ],
  transitions: [
    { to: 'PENDING', label: '提交审核' },
    { to: 'SHIPPED', label: '发货出库' },
    { to: 'TRACKING', label: '货件跟踪' },
    { to: 'HELD', label: '保持' },
    { to: 'CANCELLED', label: '取消' },
  ],
};

export default function WimoorShipmentShipmentPage() {
  return <MasterDataWorkbench config={config} />;
}
