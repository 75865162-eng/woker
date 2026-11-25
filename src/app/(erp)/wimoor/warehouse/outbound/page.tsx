'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「仓库 → 出入库 → 出库单」功能迁移。
 * 源组件：erp/warehouse/outbound/index.vue + components/table.vue
 * 还原交互：出库编码/SKU 搜索 / 仓库筛选 / 日期筛选 / 添加出库单 / 删除 / 导入(上传文件) / 导出 /
 *          下载模板 / 详情 / 提交-审核-完成-取消 状态流转。
 * 说明：Excel 导入导出为外部文件动作，本项目保留按钮语义与字段，不臆造上传结果。
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
  kind: 'warehouse.outbound',
  type: 'document',
  title: '出库单',
  subtitle: 'WIMOOR 出库单迁移：出库仓库/收件人/物流快递/快递单号/申请人/创建时间与状态流转',
  addLabel: '添加出库单',
  searchPlaceholder: '请输入出库编码或SKU',
  transitions: [
    { to: 'SUBMITTED', label: '提交' },
    { to: 'APPROVED', label: '审核' },
    { to: 'COMPLETED', label: '完成' },
    { to: 'CANCELLED', label: '取消' },
  ],
  extraFilters: [
    { key: 'warehouseid', label: '出库仓库', placeholder: '请输入仓库ID' },
    { key: 'fromDate', label: '开始日期', kind: 'date' },
    { key: 'toDate', label: '结束日期', kind: 'date' },
  ],
  columns: [
    { key: 'docNo', label: '出库单编码', width: 160 },
    { key: 'wtoname', label: '出库仓库', width: 140, render: (row) => <span>{String(ext(row).wtoname ?? '—')}</span> },
    { key: 'customer', label: '收件人', width: 130, render: (row) => <span>{String(ext(row).customer ?? '—')}</span> },
    { key: 'express', label: '物流快递', width: 120, render: (row) => <span>{String(ext(row).express ?? '—')}</span> },
    { key: 'expressno', label: '快递单号', width: 160, render: (row) => <span>{String(ext(row).expressno ?? '—')}</span> },
    { key: 'partnerCode', label: '申请人', width: 110 },
    { key: 'amount', label: '出库数量', width: 110, numeric: true },
    { key: 'status', label: '状态', width: 100, render: (row) => <span>{STATUS[String(row.status)] ?? String(row.status ?? '—')}</span> },
    { key: 'businessDate', label: '创建时间', width: 160 },
    { key: 'remark', label: '备注', width: 180 },
  ],
  fields: [
    { key: 'docNo', label: '出库单编码', required: true, placeholder: '请输入出库单编码' },
    { key: 'wtoname', label: '出库仓库', placeholder: '请输入出库仓库' },
    { key: 'customer', label: '收件人', placeholder: '请输入收件人' },
    { key: 'express', label: '物流快递', placeholder: '请输入物流快递' },
    { key: 'expressno', label: '快递单号', placeholder: '请输入快递单号' },
    { key: 'amount', label: '出库数量', kind: 'number', placeholder: '请输入出库数量' },
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

export default function WimoorWarehouseOutboundPage() {
  return <MasterDataWorkbench config={config} />;
}
