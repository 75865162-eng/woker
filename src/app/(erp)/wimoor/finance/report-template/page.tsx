'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「财务 → 财务报表 → 报表模板」功能迁移。
 * 源组件：finance/report/templates/index.vue
 * 还原交互：模板搜索 / 新建模板 / 修改 / 删除 / 自动创建(四类标准模板，含 BALANCE_SHEET/INCOME_STATEMENT/CASH_FLOW/EQUITY_CHANGE)。
 * 字段：模板名称、模板编码、模板类型、模板描述、状态；左侧模板树在本项目等价为列表 + 搜索。
 */
const TYPES = [
  { value: 'BALANCE_SHEET', label: '资产负债表' },
  { value: 'INCOME_STATEMENT', label: '利润表' },
  { value: 'CASH_FLOW', label: '现金流量表' },
  { value: 'EQUITY_CHANGE', label: '所有者权益变动表' },
];
const TYPE_LABELS: Record<string, string> = Object.fromEntries(TYPES.map(t => [t.value, t.label]));
const config: MasterDataWorkbenchConfig = {
  kind: 'finance.report-template',
  title: '报表模板',
  subtitle: 'WIMOOR 报表模板迁移：模板名称/编码/类型/描述/状态（自动创建四类标准模板）',
  addLabel: '新建模板',
  searchPlaceholder: '搜索模板...',
  columns: [
    { key: 'templateName', label: '模板名称', width: 200 },
    { key: 'templateCode', label: '模板编码', width: 240 },
    {
      key: 'templateType', label: '模板类型', width: 180,
      render: (row) => <span>{TYPE_LABELS[String(row.templateType)] ?? (row.templateType ? String(row.templateType) : '—')}</span>,
    },
    { key: 'description', label: '模板描述', width: 240 },
    {
      key: 'status', label: '状态', width: 90,
      render: (row) => <span className={String(row.status) === '1' ? 'text-success-ink' : 'text-muted'}>{String(row.status) === '1' ? '启用' : '停用'}</span>,
    },
  ],
  fields: [
    { key: 'templateName', label: '模板名称', required: true, placeholder: '请输入模板名称' },
    { key: 'templateCode', label: '模板编码', required: true, placeholder: '请输入模板编码，如BALANCE_SHEET' },
    { key: 'templateType', label: '模板类型', kind: 'select', required: true, placeholder: '请选择模板类型', options: TYPES },
    { key: 'description', label: '模板描述', placeholder: '请输入模板描述' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: '1',
      options: [{ value: '1', label: '启用' }, { value: '0', label: '停用' }],
    },
  ],
};

export default function WimoorFinanceReportTemplatePage() {
  return <MasterDataWorkbench config={config} />;
}
