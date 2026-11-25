'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「财务 → 凭证管理 → 查凭证」功能迁移。
 * 源组件：finance/vouchers/list/index.vue
 * 还原交互：日期/期间/凭证字号/摘要/会计科目/制单人 搜索 / 审核(状态流转) / 导出 / 导入凭证 / 上传附件 / 编辑 / 删除。
 * 列：凭证日期、凭证字号、摘要、科目、借方金额、贷方金额、附件数量、附件上传、原单据编号、
 * 制单人、审核人、状态(审核状态)、备注、制单日期。
 * 说明：按单据(document)类型存储，docNo=凭证字号、businessDate=凭证日期、status=审核状态，
 * 其余扩展字段（摘要/科目/借贷金额等）存入 payload；「不自动过账」由框架状态流转保证。
 */
type Row = Record<string, unknown>;
function ext(row: Row): Record<string, unknown> {
  const p = row.payload;
  if (!p) return {};
  if (typeof p === 'string') {
    try { return JSON.parse(p) as Record<string, unknown>; } catch { return {}; }
  }
  return p as Record<string, unknown>;
}
const AUDIT: Record<string, string> = { DRAFT: '草稿', AUDITED: '已审核', REJECTED: '已驳回' };
const config: MasterDataWorkbenchConfig = {
  kind: 'finance.voucher',
  type: 'document',
  title: '查凭证',
  subtitle: 'WIMOOR 查凭证迁移：凭证日期/字号/摘要/科目/借贷金额/附件/制单审核/状态，凭证由用户显式创建',
  addLabel: '新增凭证',
  searchPlaceholder: '凭证字号',
  transitions: [{ to: 'AUDITED', label: '审核' }],
  columns: [
    { key: 'businessDate', label: '凭证日期', width: 130 },
    { key: 'docNo', label: '凭证字号', width: 130 },
    { key: 'summary', label: '摘要', width: 220, render: (row) => <span>{String(ext(row).summary ?? '') || '—'}</span> },
    { key: 'subjectName', label: '科目', width: 160, render: (row) => <span>{String(ext(row).subjectName ?? '') || '—'}</span> },
    { key: 'debitAmount', label: '借方金额', width: 120, numeric: true, render: (row) => <span>{String(ext(row).debitAmount ?? '') || '—'}</span> },
    { key: 'creditAmount', label: '贷方金额', width: 120, numeric: true, render: (row) => <span>{String(ext(row).creditAmount ?? '') || '—'}</span> },
    { key: 'attachmentCount', label: '附件数量', width: 100, numeric: true, render: (row) => <span>{String(ext(row).attachmentCount ?? '') || '—'}</span> },
    { key: 'originalDocNo', label: '原单据编号', width: 140, render: (row) => <span>{String(ext(row).originalDocNo ?? '') || '—'}</span> },
    { key: 'preparerBy', label: '制单人', width: 100, render: (row) => <span>{String(ext(row).preparerBy ?? '') || '—'}</span> },
    { key: 'auditorBy', label: '审核人', width: 100, render: (row) => <span>{String(ext(row).auditorBy ?? '') || '—'}</span> },
    {
      key: 'status', label: '状态', width: 100,
      render: (row) => <span>{AUDIT[String(row.status)] ?? (row.status ? String(row.status) : '—')}</span>,
    },
    { key: 'remark', label: '备注', width: 180 },
  ],
  fields: [
    { key: 'docNo', label: '凭证字号', required: true, placeholder: '请输入凭证字号,不含类型' },
    { key: 'businessDate', label: '凭证日期', kind: 'date' },
    { key: 'summary', label: '摘要', placeholder: '请输入摘要' },
    { key: 'subjectName', label: '会计科目', placeholder: '请选择会计科目' },
    { key: 'debitAmount', label: '借方金额', kind: 'number', placeholder: '请输入借方金额' },
    { key: 'creditAmount', label: '贷方金额', kind: 'number', placeholder: '请输入贷方金额' },
    { key: 'currency', label: '币种', placeholder: '请输入币种' },
    { key: 'attachmentCount', label: '附件数量', kind: 'number', defaultValue: '0' },
    { key: 'originalDocNo', label: '原单据编号', placeholder: '请输入原单据编号' },
    { key: 'preparerBy', label: '制单人', placeholder: '请输入制单人' },
    { key: 'auditorBy', label: '审核人', placeholder: '请输入审核人' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
    { key: 'status', label: '审核状态', kind: 'select', defaultValue: 'DRAFT',
      options: [
        { value: 'DRAFT', label: '草稿' }, { value: 'AUDITED', label: '已审核' }, { value: 'REJECTED', label: '已驳回' },
      ],
    },
  ],
};

export default function WimoorFinanceVoucherPage() {
  return <MasterDataWorkbench config={config} />;
}
