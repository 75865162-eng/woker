'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「仓库 → 出入库 → 调库单」功能迁移。
 * 源组件：erp/warehouse/transfer/index.vue + components/header.vue
 * 还原交互：全部/未提交/待审核/配货中/已发货/已完成/已驳回 状态页签 / 调库编码-SKU-名称搜索 /
 *          日期筛选 / 添加调库单 / 导入 / 详情 / 提交-审核-发货-收货-驳回 状态流转。
 * 状态映射（框架仅允许 5 种合法流转状态）：DRAFT=未提交、SUBMITTED=待审核、APPROVED=配货中/已发货、
 * COMPLETED=已完成、CANCELLED=已驳回；历史明细存在 payload.records。
 */
type Row = Record<string, unknown>;
function ext(row: Row): Record<string, unknown> {
  const p = row.payload;
  if (!p) return {};
  if (typeof p === 'string') { try { return JSON.parse(p) as Record<string, unknown>; } catch { return {}; } }
  return p as Record<string, unknown>;
}
const STATUS: Record<string, string> = {
  DRAFT: '未提交', SUBMITTED: '待审核', APPROVED: '配货中/已发货', COMPLETED: '已完成', CANCELLED: '已驳回',
};
const config: MasterDataWorkbenchConfig = {
  kind: 'warehouse.transfer',
  type: 'document',
  title: '调库单',
  subtitle: 'WIMOOR 调库单迁移：调出/调入仓库、状态流转（提交/审核/发货/收货/驳回）、申请与审核人、备注',
  addLabel: '添加调库单',
  searchPlaceholder: '输入调库编码,SKU或名称',
  transitions: [
    { to: 'SUBMITTED', label: '提交' },
    { to: 'APPROVED', label: '审核/发货' },
    { to: 'COMPLETED', label: '收货完成' },
    { to: 'CANCELLED', label: '驳回' },
  ],
  extraFilters: [
    { key: 'fromDate', label: '开始日期', kind: 'date' },
    { key: 'toDate', label: '结束日期', kind: 'date' },
  ],
  columns: [
    { key: 'docNo', label: '调库单编码', width: 150 },
    { key: 'fromWarehouse', label: '调出仓库', width: 140, render: (row) => <span>{String(ext(row).wfname ?? '—')}</span> },
    { key: 'toWarehouse', label: '调入仓库', width: 140, render: (row) => <span>{String(ext(row).wtname ?? '—')}</span> },
    { key: 'status', label: '状态', width: 130, render: (row) => <span>{STATUS[String(row.status)] ?? String(row.status ?? '—')}</span> },
    { key: 'partnerCode', label: '申请人', width: 110 },
    { key: 'businessDate', label: '申请时间', width: 160 },
    { key: 'auditor', label: '审核人', width: 110, render: (row) => <span>{String(ext(row).auditor ?? '—')}</span> },
    { key: 'auditTime', label: '审核时间', width: 160, render: (row) => <span>{String(ext(row).audittime ?? '—')}</span> },
    { key: 'remark', label: '备注', width: 180 },
  ],
  fields: [
    { key: 'docNo', label: '调库单编码', required: true, placeholder: '请输入调库单编码' },
    { key: 'wfname', label: '调出仓库', placeholder: '请输入调出仓库' },
    { key: 'wtname', label: '调入仓库', placeholder: '请输入调入仓库' },
    { key: 'amount', label: '调动数量', kind: 'number', placeholder: '请输入调动数量' },
    { key: 'partnerCode', label: '申请人', placeholder: '请输入申请人' },
    { key: 'businessDate', label: '申请时间', kind: 'date' },
    { key: 'auditor', label: '审核人', placeholder: '请输入审核人' },
    { key: 'audittime', label: '审核时间', kind: 'date' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'DRAFT',
      options: [
        { value: 'DRAFT', label: '未提交' }, { value: 'SUBMITTED', label: '待审核' },
        { value: 'APPROVED', label: '配货中/已发货' }, { value: 'COMPLETED', label: '已完成' },
        { value: 'CANCELLED', label: '已驳回' },
      ],
    },
  ],
};

export default function WimoorWarehouseTransferPage() {
  return <MasterDataWorkbench config={config} />;
}
