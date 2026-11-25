'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「仓库 → 出入库 → 代料单」功能迁移。
 * 源组件：erp/warehouse/exchange/index.vue + components/header.vue
 * 还原交互：代料编码/SKU 搜索 / 日期筛选 / 添加代料单 / 导入 / 下载模板 / 删除（撤销库存） / 详情 /
 *          提交-审核-完成-撤销 状态流转。
 * 说明：删除后库存撤销以 CANCELLED 状态流转表达，不自动过账。
 */
type Row = Record<string, unknown>;
function ext(row: Row): Record<string, unknown> {
  const p = row.payload;
  if (!p) return {};
  if (typeof p === 'string') { try { return JSON.parse(p) as Record<string, unknown>; } catch { return {}; } }
  return p as Record<string, unknown>;
}
const STATUS: Record<string, string> = {
  DRAFT: '草稿', SUBMITTED: '已提交', APPROVED: '已审核', COMPLETED: '已完成', CANCELLED: '已撤销',
};
const config: MasterDataWorkbenchConfig = {
  kind: 'warehouse.exchange',
  type: 'document',
  title: '代料单',
  subtitle: 'WIMOOR 代料单迁移：调出/调入SKU、调动数量、操作仓库、创建人与状态流转（含撤销库存）',
  addLabel: '添加代料单',
  searchPlaceholder: '输入代料编码或SKU',
  transitions: [
    { to: 'SUBMITTED', label: '提交' },
    { to: 'APPROVED', label: '审核' },
    { to: 'COMPLETED', label: '完成' },
    { to: 'CANCELLED', label: '删除/撤销' },
  ],
  extraFilters: [
    { key: 'fromDate', label: '开始日期', kind: 'date' },
    { key: 'toDate', label: '结束日期', kind: 'date' },
  ],
  columns: [
    { key: 'docNo', label: '单据编码', width: 150 },
    { key: 'skuFrom', label: '调出SKU', width: 160, render: (row) => <span>{String(ext(row).sku_from ?? '—')}</span> },
    { key: 'skuTo', label: '调入SKU', width: 160, render: (row) => <span>{String(ext(row).sku_to ?? '—')}</span> },
    { key: 'amount', label: '调动数量', width: 120, numeric: true },
    { key: 'warehouse', label: '操作仓库', width: 140, render: (row) => <span>{String(ext(row).warehouse ?? '—')}</span> },
    { key: 'status', label: '状态', width: 100, render: (row) => <span>{STATUS[String(row.status)] ?? String(row.status ?? '—')}</span> },
    { key: 'partnerCode', label: '创建人', width: 110 },
    { key: 'businessDate', label: '创建时间', width: 160 },
    { key: 'remark', label: '备注', width: 180 },
  ],
  fields: [
    { key: 'docNo', label: '单据编码', required: true, placeholder: '请输入代料单编码' },
    { key: 'sku_from', label: '调出SKU', placeholder: '请输入调出SKU' },
    { key: 'sku_to', label: '调入SKU', placeholder: '请输入调入SKU' },
    { key: 'amount', label: '调动数量', kind: 'number', placeholder: '请输入调动数量' },
    { key: 'warehouse', label: '操作仓库', placeholder: '请输入操作仓库' },
    { key: 'partnerCode', label: '创建人', placeholder: '请输入创建人' },
    { key: 'businessDate', label: '创建时间', kind: 'date' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'DRAFT',
      options: [
        { value: 'DRAFT', label: '草稿' }, { value: 'SUBMITTED', label: '已提交' },
        { value: 'APPROVED', label: '已审核' }, { value: 'COMPLETED', label: '已完成' },
        { value: 'CANCELLED', label: '已撤销' },
      ],
    },
  ],
};

export default function WimoorWarehouseExchangePage() {
  return <MasterDataWorkbench config={config} />;
}
