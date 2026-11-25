'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「财务 → 财务报表 → 报表项目」功能迁移。
 * 源组件：finance/report/items/index.vue + templates/components/template_item_edit.vue
 * 还原交互：Tab(报表模板) 切换 / 报表项目树表(行次/编码/名称/级别/计算类型/计算规则/状态) / 新增 / 修改 / 删除。
 * 字段忠实还原自 template_item_edit.vue：项目编码/名称、父级项目、级别、行次、项目类型、项目分类、
 * 公式类型、数据来源、关联科目编码、金额类型、计算规则、公式内容、显示格式、是否显示、排序、状态。
 */
const LABELS: Record<string, string> = {
  DIRECT: '直接取值', FORMULA: '公式计算', CUSTOM: '自定义', CALCULATED: '自动计算',
};
const config: MasterDataWorkbenchConfig = {
  kind: 'finance.report-item',
  title: '报表项目',
  subtitle: 'WIMOOR 报表项目迁移：项目编码/名称/级别/行次/公式类型/计算规则/状态，按模板组织',
  addLabel: '新增报表项目',
  searchPlaceholder: '项目编码/名称',
  columns: [
    { key: 'lineNumber', label: '行次', width: 70, numeric: true },
    { key: 'itemCode', label: '项目编码', width: 140 },
    { key: 'itemName', label: '项目名称', width: 200 },
    { key: 'itemLevel', label: '级别', width: 90 },
    {
      key: 'formulaType', label: '计算类型', width: 120,
      render: (row) => <span>{LABELS[String(row.formulaType)] ?? (row.formulaType ? String(row.formulaType) : '—')}</span>,
    },
    { key: 'calculationRule', label: '计算规则', width: 220 },
    {
      key: 'status', label: '状态', width: 90,
      render: (row) => <span className={String(row.status) === '1' ? 'text-success-ink' : 'text-muted'}>{String(row.status) === '1' ? '启用' : '停用'}</span>,
    },
  ],
  fields: [
    { key: 'itemCode', label: '项目编码', required: true, placeholder: '请输入项目编码' },
    { key: 'itemName', label: '项目名称', required: true, placeholder: '请输入项目名称' },
    { key: 'parentCode', label: '父级项目', placeholder: '请输入父级项目编码' },
    { key: 'itemLevel', label: '项目级别', kind: 'select', placeholder: '请选择项目级别',
      options: [
        { value: '1', label: '一级项目' }, { value: '2', label: '二级项目' },
        { value: '3', label: '三级项目' }, { value: '4', label: '四级项目' },
      ],
    },
    { key: 'lineNumber', label: '行次', kind: 'number', placeholder: '请输入行次' },
    { key: 'itemType', label: '项目类型', kind: 'select', placeholder: '请选择项目类型',
      options: [
        { value: 'ASSET', label: '资产' }, { value: 'LIABILITY', label: '负债' },
        { value: 'EQUITY', label: '权益' }, { value: 'INCOME', label: '收入' },
        { value: 'COST', label: '成本' }, { value: 'EXPENSE', label: '费用' },
      ],
    },
    { key: 'itemCategory', label: '项目分类', placeholder: '请输入项目分类' },
    { key: 'formulaType', label: '公式类型', kind: 'select', defaultValue: 'DIRECT',
      options: [
        { value: 'DIRECT', label: '直接取值' }, { value: 'FORMULA', label: '公式计算' },
        { value: 'CUSTOM', label: '自定义' }, { value: 'CALCULATED', label: '自动计算' },
      ],
    },
    { key: 'dataSource', label: '数据来源', kind: 'select', placeholder: '请选择数据来源',
      options: [
        { value: 'SUBJECT', label: '会计科目' }, { value: 'CUSTOM', label: '自定义' },
        { value: 'CALCULATED', label: '计算' }, { value: 'CONSTANT', label: '常量' },
      ],
    },
    { key: 'subjectCodes', label: '关联科目编码', placeholder: '多个用逗号分隔' },
    { key: 'amountType', label: '金额类型', kind: 'select', placeholder: '请选择金额类型',
      options: [
        { value: 'END_BALANCE', label: '期末余额' }, { value: 'BEGIN_BALANCE', label: '期初余额' },
        { value: 'DEBIT_TOTAL', label: '借方发生额' }, { value: 'CREDIT_TOTAL', label: '贷方发生额' },
      ],
    },
    { key: 'calculationRule', label: '计算规则', placeholder: '请输入计算规则' },
    { key: 'formulaContent', label: '公式内容', placeholder: '请输入公式内容' },
    { key: 'sortOrder', label: '排序', kind: 'number', defaultValue: '0' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: '1',
      options: [{ value: '1', label: '启用' }, { value: '0', label: '禁用' }],
    },
  ],
};

export default function WimoorFinanceReportItemPage() {
  return <MasterDataWorkbench config={config} />;
}
