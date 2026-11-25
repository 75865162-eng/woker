'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「广告 → 广告报表 → 广告规则」功能迁移。
 * 源组件：amazon/advertisement/rules/index.vue + manager/components/common/schedule_plan.vue
 * 还原交互：预算规则/竞价规则标签页 + 商品推广/品牌推广/展示推广(sp/sb/sd)切换 + 规则名称搜索 + 新建(分时策略)
 *          + 创建时间/名称/状态/预算增加依据/区间/执行频率/指标列 + 保存为模板/保存并应用/更新模板/应用模板 + 分页。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'ads.rules',
  title: '广告规则',
  subtitle: 'WIMOOR 广告规则功能迁移：预算规则/竞价规则、推广类型、规则状态、预算增加比例、区间、执行频率与指标',
  addLabel: '新建规则',
  searchPlaceholder: '请输入规则名称',
  columns: [
    { key: 'created_date', label: '创建时间', width: 160 },
    { key: 'name', label: '名称', width: 200 },
    {
      key: 'rule_state', label: '状态', width: 100,
      render: (row) => {
        const active = String(row.rule_state ?? '').toUpperCase() === 'ACTIVE';
        return <span className={active ? 'text-success-ink' : 'text-muted'}>{active ? 'ACTIVE（开启）' : 'PAUSED（暂停）'}</span>;
      },
    },
    { key: 'budget_increase_by', label: '预算增加依据', width: 140, numeric: true,
      render: (row) => <span>{row.budget_increase_by == null ? '—' : `${String(row.budget_increase_by)}%`}</span>,
    },
    { key: 'duration', label: '区间', width: 220 },
    {
      key: 'recurrence', label: '执行频率', width: 140,
      render: (row) => <span>{String(row.recurrence ?? '—') === 'DAILY' ? '每日重复' : '重复周期'}</span>,
    },
    { key: 'performance_measure_condition', label: '指标', width: 200 },
  ],
  fields: [
    { key: 'code', label: '规则编码', required: true, placeholder: '如 RULE-0001' },
    { key: 'name', label: '规则名称', required: true, placeholder: '请输入规则名称' },
    { key: 'created_date', label: '创建时间', kind: 'date' },
    { key: 'rule_state', label: '策略状态', kind: 'select', defaultValue: 'ACTIVE',
      options: [{ value: 'ACTIVE', label: '开启' }, { value: 'PAUSED', label: '暂停' }],
    },
    { key: 'budget_increase_by', label: '预算增加比例(%)', kind: 'number', max: 100, placeholder: '请输入百分比' },
    { key: 'duration', label: '区间(起止时间)', placeholder: '非必填，如 2026-01-01 至 2026-01-31' },
    { key: 'recurrence', label: '执行频率', kind: 'select', defaultValue: 'DAILY',
      options: [{ value: 'DAILY', label: '每日重复' }, { value: 'WEEKLY', label: '重复周期' }],
    },
    { key: 'daysOfWeek', label: '执行日期', kind: 'select', defaultValue: 'MONDAY',
      options: [
        { value: 'MONDAY', label: '周一' }, { value: 'TUESDAY', label: '周二' },
        { value: 'WEDNESDAY', label: '周三' }, { value: 'THURSDAY', label: '周四' },
        { value: 'FRIDAY', label: '周五' }, { value: 'SATURDAY', label: '周六' },
        { value: 'SUNDAY', label: '周日' },
      ],
    },
    { key: 'startTime', label: '开始时间', placeholder: '如 08:00' },
    { key: 'endTime', label: '结束时间', placeholder: '如 22:00' },
    { key: 'performance_measure_condition', label: '指标', placeholder: '如 ACOS > 10%' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
  ],
  extraFilters: [
    { key: 'ruleType', label: '规则标签', kind: 'select', defaultValue: 'budget',
      options: [{ value: 'budget', label: '预算规则' }, { value: 'bidding', label: '竞价规则' }],
    },
    { key: 'adverttype', label: '推广类型', kind: 'select', defaultValue: 'sp',
      options: [
        { value: 'sp', label: '商品推广' }, { value: 'sb', label: '品牌推广' }, { value: 'sd', label: '展示推广' },
      ],
    },
  ],
};

export default function WimoorAdsRulesPage() {
  return <MasterDataWorkbench config={config} />;
}
