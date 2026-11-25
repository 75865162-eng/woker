'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「财务 → 配置 → 科目管理」功能迁移（本项目 finance-structure 已在 operations 提供账套/科目工作台，本页为 WIMOOR 菜单入口的等价列表页）。
 * 源组件：finance/subjects/index.vue
 * 还原交互：科目类型 Tab / 搜索(编码/名称/父级编码/余额方向) / 新增 / 修改 / 删除 / 展开折叠(本项目以平表承载)。
 * 字段：科目编码(4-2-2-2 编码规则)、名称、级别、父级编码、科目类别、余额方向(借/贷)、末级科目、状态，
 * 以及辅助核算/数量核算/外币核算等开关字段。
 */
const LEVELS = [
  { value: '1', label: '一级' }, { value: '2', label: '二级' },
  { value: '3', label: '三级' }, { value: '4', label: '四级' },
];
const DIRECTIONS = [{ value: '1', label: '借' }, { value: '2', label: '贷' }];
const yesNo = [{ value: '1', label: '是' }, { value: '0', label: '否' }];
const config: MasterDataWorkbenchConfig = {
  kind: 'finance.subject',
  title: '科目管理',
  subtitle: 'WIMOOR 科目管理迁移：科目编码/名称/级别/类别/余额方向/末级科目/状态（4-2-2-2 编码规则）',
  addLabel: '新增科目',
  searchPlaceholder: '科目编码/名称',
  columns: [
    { key: 'subjectName', label: '科目名称', width: 240 },
    { key: 'subjectCode', label: '科目编码', width: 140 },
    {
      key: 'subjectLevel', label: '科目级别', width: 100,
      render: (row) => <span>{LEVELS.find(l => l.value === String(row.subjectLevel))?.label ?? '—'}</span>,
    },
    { key: 'parentCode', label: '父级编码', width: 120 },
    { key: 'subjectTypeName', label: '科目类别', width: 140 },
    {
      key: 'direction', label: '余额方向', width: 100,
      render: (row) => <span>{DIRECTIONS.find(d => d.value === String(row.direction))?.label ?? '—'}</span>,
    },
    {
      key: 'isLeaf', label: '末级科目', width: 100,
      render: (row) => <span>{yesNo.find(o => o.value === String(row.isLeaf))?.label ?? '—'}</span>,
    },
    {
      key: 'status', label: '状态', width: 90,
      render: (row) => <span className={String(row.status) === '1' ? 'text-success-ink' : 'text-muted'}>{String(row.status) === '1' ? '启用' : '停用'}</span>,
    },
  ],
  fields: [
    { key: 'subjectCode', label: '科目编码', required: true, max: 10,
      placeholder: '4-2-2-2规则：一级4位，二级6位，三级8位，四级10位' },
    { key: 'subjectName', label: '科目名称', required: true, placeholder: '请输入科目名称' },
    { key: 'subjectLevel', label: '科目级别', kind: 'select', placeholder: '请选择科目级别', options: LEVELS },
    { key: 'parentCode', label: '父级编码', placeholder: '请选择父级科目编码' },
    { key: 'subjectTypeName', label: '科目类别', placeholder: '请选择科目类别' },
    { key: 'direction', label: '余额方向', kind: 'select', placeholder: '请选择余额方向', options: DIRECTIONS },
    { key: 'isLeaf', label: '末级科目', kind: 'select', defaultValue: '1', options: yesNo },
    { key: 'isCash', label: '现金科目', kind: 'select', defaultValue: '0', options: yesNo },
    { key: 'isAuxiliary', label: '辅助核算', kind: 'select', defaultValue: '0', options: yesNo },
    { key: 'isQuantity', label: '数量核算', kind: 'select', defaultValue: '0', options: yesNo },
    { key: 'unitOfMeasure', label: '计量单位', placeholder: '请输入计量单位' },
    { key: 'isForeignCurrency', label: '外币核算', kind: 'select', defaultValue: '0', options: yesNo },
    { key: 'status', label: '状态', kind: 'select', defaultValue: '1',
      options: [{ value: '1', label: '启用' }, { value: '0', label: '停用' }],
    },
  ],
  extraFilters: [
    { key: 'direction', label: '余额方向', kind: 'select', placeholder: '请选择余额方向', options: DIRECTIONS },
    { key: 'status', label: '状态', kind: 'select', placeholder: '请选择状态',
      options: [{ value: '1', label: '启用' }, { value: '0', label: '停用' }],
    },
  ],
};

export default function WimoorFinanceSubjectsPage() {
  return <MasterDataWorkbench config={config} />;
}
