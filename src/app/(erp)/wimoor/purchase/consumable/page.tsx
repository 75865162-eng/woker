'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「采购 → 采购管理 → 发货准备」功能迁移。
 * 源组件：erp/purchase/consumable/index.vue + components/consumable_material.vue
 * 还原交互：Tab(成品包装/批量组装) / 仓库级联 / 开始日期·结束日期 / 搜索维度(SKU、订单编号)
 *          / 搜索 / 单据字段(单号、状态、仓库、日期、数量、SKU、订单编号、备注) / 详情 / 下载。
 * 注：批量组装 Tab 即加工单页面（kind=purchase.process），本页承载成品包装发货准备单据。
 */
const STATUS: Record<string, string> = { PENDING: '待准备', READY: '已备货', SHIPPED: '已发货' };

const config: MasterDataWorkbenchConfig = {
  kind: 'purchase.consumable',
  type: 'document',
  title: '发货准备',
  subtitle: 'WIMOOR 发货准备迁移：成品包装/批量组装，仓库、日期区间、SKU·订单编号搜索与备货单据交互',
  addLabel: '新增发货准备',
  searchPlaceholder: 'SKU/订单编号/单号',
  columns: [
    { key: 'docNo', label: '准备单号', width: 150 },
    { key: 'sku', label: 'SKU', width: 160 },
    { key: 'orderNo', label: '订单编号', width: 150 },
    { key: 'partnerCode', label: '操作仓库', width: 140 },
    { key: 'businessDate', label: '准备日期', width: 150 },
    { key: 'amount', label: '数量', width: 100, numeric: true },
    { key: 'status', label: '状态', width: 100, render: (row) => <span>{STATUS[String(row.status)] ?? String(row.status ?? '—')}</span> },
    { key: 'remark', label: '备注', width: 180 },
  ],
  fields: [
    { key: 'docNo', label: '准备单号', required: true, placeholder: '请输入准备单号' },
    { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
    { key: 'orderNo', label: '订单编号', placeholder: '请输入订单编号' },
    { key: 'partnerCode', label: '操作仓库', placeholder: '请输入仓库编码/名称' },
    { key: 'businessDate', label: '准备日期', kind: 'date' },
    { key: 'amount', label: '数量', kind: 'number' },
    { key: 'currency', label: '币种', kind: 'select', defaultValue: 'CNY',
      options: [{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元' }],
    },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'PENDING',
      options: [
        { value: 'PENDING', label: '待准备' }, { value: 'READY', label: '已备货' }, { value: 'SHIPPED', label: '已发货' },
      ],
    },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
  ],
  extraFilters: [
    { key: 'searchType', label: '搜索维度', kind: 'select', defaultValue: 'sku',
      options: [{ value: 'sku', label: 'SKU' }, { value: 'number', label: '订单编号' }],
    },
    { key: 'warehouse', label: '仓库', placeholder: '请输入仓库' },
    { key: 'fromDate', label: '开始日期', kind: 'date' },
    { key: 'endDate', label: '结束日期', kind: 'date' },
  ],
  transitions: [{ to: 'READY', label: '备货完成' }, { to: 'SHIPPED', label: '发货' }],
};

export default function WimoorPurchaseConsumablePage() {
  return <MasterDataWorkbench config={config} />;
}
