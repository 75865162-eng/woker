'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「账目 → 本地账目 → 采购记账」功能迁移（新增页，单据型）。
 * 源组件：erp/finance/account/index.vue（概览/记账/转结 三个页签）
 *        + components/bookkeeping.vue（新建记账表单 + 记账记录表格）。
 * 还原交互：记账记录查询(店铺/账户/类型/收支项目)、新建记账必填项(店铺/账户/记账类型/收支项目/金额)、
 * 备注、收入/支出标签、「撤销」状态流转、日期与分页；概览账户卡片/图表与转结明细保留在等价实现。
 * 以 document 存储：docNo=记账单号、businessDate=记账日期、amount=金额、status=记账状态，
 * 店铺/账户/类型/收支项目存 payload；撤销只改状态，不自动过账。
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
const config: MasterDataWorkbenchConfig = {
  kind: 'account.account',
  type: 'document',
  title: '采购记账',
  subtitle: 'WIMOOR 采购记账迁移：店铺、账户、收入/支出、收支项目与金额完整交互；记账单据由用户显式创建。',
  addLabel: '新建记账',
  searchPlaceholder: '搜索收支项目/账户',
  transitions: [{ to: 'CANCELLED', label: '撤销' }],
  columns: [
    { key: 'businessDate', label: '日期', width: 140 },
    { key: 'groupName', label: '店铺', width: 130, render: (row) => <span>{String(ext(row).groupName ?? '') || '—'}</span> },
    { key: 'acctName', label: '账户', width: 180, render: (row) => <span>{String(ext(row).acctName ?? '') || '—'}</span> },
    {
      key: 'ftype', label: '记账类型', width: 110,
      render: (row) => <span className={ext(row).ftype === 'in' ? 'text-success-ink' : 'text-danger-ink'}>{ext(row).ftype === 'in' ? '收入' : '支出'}</span>,
    },
    { key: 'name', label: '收支项目', width: 200, render: (row) => <span>{String(ext(row).name ?? '') || '—'}</span> },
    { key: 'amount', label: '金额(￥)', width: 120, numeric: true },
    { key: 'remark', label: '备注', width: 180 },
    { key: 'status', label: '状态', width: 100, render: (row) => <span>{row.status === 'CANCELLED' ? '已撤销' : '正常'}</span> },
  ],
  fields: [
    { key: 'docNo', label: '记账单号', required: true, placeholder: '请输入记账单号' },
    { key: 'businessDate', label: '日期', kind: 'date' },
    { key: 'groupName', label: '店铺', required: true, placeholder: '请输入店铺' },
    { key: 'acctName', label: '账户', required: true, placeholder: '请选择账户' },
    { key: 'ftype', label: '记账类型', required: true, kind: 'select', defaultValue: 'out',
      options: [{ value: 'in', label: '收入' }, { value: 'out', label: '支出' }] },
    { key: 'projectid', label: '收支项目ID', placeholder: '请输入收支项目ID' },
    { key: 'name', label: '收支项目', required: true, placeholder: '请选择收支项目' },
    { key: 'amount', label: '金额', required: true, kind: 'number', placeholder: '请输入金额' },
    { key: 'currency', label: '币种', kind: 'select', defaultValue: 'CNY',
      options: [{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元' }] },
    { key: 'remark', label: '备注', placeholder: '请输入备注信息' },
    { key: 'status', label: '记账状态', kind: 'select', defaultValue: 'NORMAL',
      options: [{ value: 'NORMAL', label: '正常' }, { value: 'CANCELLED', label: '已撤销' }] },
  ],
  extraFilters: [
    { key: 'groupName', label: '店铺', placeholder: '请输入店铺' },
    { key: 'acctName', label: '账户', placeholder: '请选择账户' },
    { key: 'ftype', label: '类型', kind: 'select',
      options: [{ value: '', label: '全部' }, { value: 'in', label: '收入' }, { value: 'out', label: '支出' }] },
    { key: 'name', label: '收支项目', placeholder: '全部收支项目' },
    { key: 'fromDate', label: '开始日期', kind: 'date' },
    { key: 'toDate', label: '结束日期', kind: 'date' },
  ],
};

export default function WimoorAccountAccountPage() {
  return <MasterDataWorkbench config={config} />;
}
