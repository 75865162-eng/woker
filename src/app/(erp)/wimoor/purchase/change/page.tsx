'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「采购 → 采购管理 → 采购换货单」功能迁移。
 * 源组件：erp/purchase/change/index.vue
 * 还原交互：详情 / 换货单编码 / 采购单编码 / 操作仓库 / 状态 / SKU / 数量 / 申请人 / 申请时间 / 备注。
 * 注：详情为行级查看动作，由表格字段承载；状态流转为申请中→已换货。
 */
const STATUS: Record<string, string> = { PENDING: '申请中', APPROVED: '已同意', DONE: '已换货' };

const config: MasterDataWorkbenchConfig = {
  kind: 'purchase.change',
  type: 'document',
  title: '采购换货单',
  subtitle: 'WIMOOR 采购换货单迁移：单号/状态/操作仓库/SKU/数量/申请人/申请时间/备注完整交互',
  addLabel: '新增换货单',
  searchPlaceholder: '换货单编码/采购单编码',
  columns: [
    { key: 'docNo', label: '换货单编码', width: 150 },
    { key: 'purchaseNo', label: '采购单编码', width: 150 },
    { key: 'partnerCode', label: '操作仓库', width: 140 },
    { key: 'status', label: '状态', width: 100, render: (row) => <span>{STATUS[String(row.status)] ?? String(row.status ?? '—')}</span> },
    { key: 'sku', label: 'SKU', width: 160 },
    { key: 'amount', label: '数量', width: 100, numeric: true },
    { key: 'creator', label: '申请人', width: 110 },
    { key: 'businessDate', label: '申请时间', width: 150 },
    { key: 'remark', label: '备注', width: 180 },
  ],
  fields: [
    { key: 'docNo', label: '换货单编码', required: true, placeholder: '请输入换货单编码' },
    { key: 'purchaseNo', label: '采购单编码', placeholder: '请输入采购单编码' },
    { key: 'partnerCode', label: '操作仓库', placeholder: '请输入仓库编码/名称' },
    { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
    { key: 'amount', label: '数量', kind: 'number' },
    { key: 'businessDate', label: '申请时间', kind: 'date' },
    { key: 'creator', label: '申请人', placeholder: '请输入申请人' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'PENDING',
      options: [
        { value: 'PENDING', label: '申请中' }, { value: 'APPROVED', label: '已同意' }, { value: 'DONE', label: '已换货' },
      ],
    },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
  ],
  extraFilters: [
    { key: 'purchaseNoFilter', label: '采购单编码', placeholder: '请输入采购单编码' },
    { key: 'skuFilter', label: 'SKU', placeholder: '请输入SKU' },
    { key: 'warehouse', label: '操作仓库', placeholder: '请输入仓库' },
  ],
  transitions: [{ to: 'APPROVED', label: '同意换货' }, { to: 'DONE', label: '换货完成' }],
};

export default function WimoorPurchaseChangePage() {
  return <MasterDataWorkbench config={config} />;
}
