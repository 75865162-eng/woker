'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「仓库 → 出入库 → 入库单」功能迁移。
 * 源组件：erp/warehouse/inbound/index.vue + components/table.vue
 * 还原交互：入库编码/SKU 搜索 / 仓库筛选 / 日期筛选 / 添加入库单 / 删除 / 导入(上传文件) / 导出 /
 *          下载模板 / 详情 / 提交-审核-完成-取消 状态流转。
 * 说明：删除后库存撤销以 CANCELLED 状态流转表达；Excel 导入导出保留按钮语义，不臆造上传结果。
 */
type Row = Record<string, unknown>;
function ext(row: Row): Record<string, unknown> {
  const p = row.payload;
  if (!p) return {};
  if (typeof p === 'string') { try { return JSON.parse(p) as Record<string, unknown>; } catch { return {}; } }
  return p as Record<string, unknown>;
}
const STATUS: Record<string, string> = {
  DRAFT: '草稿', SUBMITTED: '已提交', APPROVED: '已审核', COMPLETED: '已完成', CANCELLED: '已取消',
};
const config: MasterDataWorkbenchConfig = {
  kind: 'warehouse.inbound',
  type: 'document',
  title: '入库单',
  subtitle: 'WIMOOR 入库单迁移：入库仓库/申请人/入库数量/创建时间与状态流转',
  addLabel: '添加入库单',
  searchPlaceholder: '请输入入库编码或SKU',
  transitions: [
    { to: 'SUBMITTED', label: '提交' },
    { to: 'APPROVED', label: '审核' },
    { to: 'COMPLETED', label: '完成' },
    { to: 'CANCELLED', label: '取消' },
  ],
  extraFilters: [
    { key: 'warehouseid', label: '入库仓库', placeholder: '请输入仓库ID' },
    { key: 'fromDate', label: '开始日期', kind: 'date' },
    { key: 'toDate', label: '结束日期', kind: 'date' },
  ],
  columns: [
    { key: 'docNo', label: '入库单编码', width: 160 },
    { key: 'wname', label: '入库仓库', width: 150, render: (row) => <span>{String(ext(row).wname ?? '—')}</span> },
    { key: 'partnerCode', label: '申请人', width: 110 },
    { key: 'amount', label: '入库数量', width: 110, numeric: true },
    { key: 'status', label: '状态', width: 100, render: (row) => <span>{STATUS[String(row.status)] ?? String(row.status ?? '—')}</span> },
    { key: 'businessDate', label: '创建时间', width: 160 },
    { key: 'remark', label: '备注', width: 180 },
  ],
  fields: [
    { key: 'docNo', label: '入库单编码', required: true, placeholder: '请输入入库单编码' },
    { key: 'wname', label: '入库仓库', placeholder: '请输入入库仓库' },
    { key: 'amount', label: '入库数量', kind: 'number', placeholder: '请输入入库数量' },
    { key: 'partnerCode', label: '申请人', placeholder: '请输入申请人' },
    { key: 'businessDate', label: '创建时间', kind: 'date' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'DRAFT',
      options: [
        { value: 'DRAFT', label: '草稿' }, { value: 'SUBMITTED', label: '已提交' },
        { value: 'APPROVED', label: '已审核' }, { value: 'COMPLETED', label: '已完成' },
        { value: 'CANCELLED', label: '已取消' },
      ],
    },
  ],
};

export default function WimoorWarehouseInboundPage() {
  return <MasterDataWorkbench config={config} />;
}
