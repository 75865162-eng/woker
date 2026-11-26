'use client';

/**
 * WIMOOR 原版「指标筛选」弹窗迁移（amazon/advertisement/manager/components/common/data_filter.vue）。
 *
 * 原版契约（忠实还原）：
 *  - 弹窗标题「指标筛选」，左侧多条件组合，右侧「我的搜索条件」历史表。
 *  - 指标 optionsList：转化率(CSRT)/曝光量(impressions)/ACOS/ROAS/花费(cost)/点击率(CTR)。
 *  - 运算符 symbolList：大于(>)/等于(=)/小于(<)。
 *  - 指标带 chartype 时输入框后缀显示 %。
 *  - 操作：添加筛选条件、删除条件（首行禁删）、清空所有、保存这次搜索、
 *    对历史条件「筛选/删除」、底部「关闭/清除/筛选」。
 *
 * 通用化：metrics/operators 可覆盖，storageKey 决定「我的搜索条件」持久化作用域。
 * 写操作不在此组件执行：onApply 仅把条件回调给页面，由页面决定是否走 preview/审批框架。
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Dialog } from '@/components/ui/overlays';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form-controls';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';

export interface MetricOption {
  value: string;
  label: string;
  /** 数值后缀是否为百分号 */
  percent?: boolean;
}

export interface FilterOperator {
  value: string;
  label: string;
}

export interface MetricCondition {
  metric: string;
  operator: string;
  value: string;
}

export interface SavedMetricFilter {
  id: string;
  label: string;
  conditions: MetricCondition[];
}

export interface MetricFilterPopoverProps {
  open: boolean;
  onClose: () => void;
  /** 指标清单，默认还原原版 6 项 */
  metrics?: MetricOption[];
  operators?: FilterOperator[];
  /** 历史搜索条件持久化 key（localStorage） */
  storageKey?: string;
  /** 点击「筛选」：返回当前条件 */
  onApply: (conditions: MetricCondition[]) => void;
  /** 点击历史项「筛选」 */
  onApplySaved?: (saved: SavedMetricFilter) => void;
}

export const DEFAULT_METRICS: MetricOption[] = [
  { value: 'CSRT', label: '转化率', percent: true },
  { value: 'impressions', label: '曝光量' },
  { value: 'ACOS', label: 'ACOS', percent: true },
  { value: 'ROAS', label: 'ROAS', percent: true },
  { value: 'cost', label: '花费' },
  { value: 'CTR', label: '点击率', percent: true },
];

export const DEFAULT_OPERATORS: FilterOperator[] = [
  { value: '>', label: '大于' },
  { value: '=', label: '等于' },
  { value: '<', label: '小于' },
];

const STORAGE_PREFIX = 'wimoor-metric-filter:';

function describe(conditions: MetricCondition[], metrics: MetricOption[], operators: FilterOperator[]) {
  return conditions.map((c) => {
    const m = metrics.find((x) => x.value === c.metric)?.label ?? c.metric;
    const op = operators.find((x) => x.value === c.operator)?.label ?? c.operator;
    return `${m} ${op} ${c.value}${metrics.find((x) => x.value === c.metric)?.percent ? '%' : ''}`;
  }).join(' 且 ');
}

export function MetricFilterPopover({
  open,
  onClose,
  metrics = DEFAULT_METRICS,
  operators = DEFAULT_OPERATORS,
  storageKey = 'default',
  onApply,
  onApplySaved,
}: MetricFilterPopoverProps) {
  const [conditions, setConditions] = useState<MetricCondition[]>([
    { metric: metrics[0]?.value ?? 'CSRT', operator: operators[0]?.value ?? '>', value: '' },
  ]);
  const [saved, setSaved] = useState<SavedMetricFilter[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
      setSaved(raw ? (JSON.parse(raw) as SavedMetricFilter[]) : []);
    } catch {
      setSaved([]);
    }
  }, [storageKey, open]);

  const metricById = useMemo(() => new Map(metrics.map((m) => [m.value, m])), [metrics]);

  const update = (index: number, patch: Partial<MetricCondition>) => {
    setConditions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };
  const addCondition = () => {
    setConditions((prev) => [...prev, { metric: metrics[0]?.value ?? 'CSRT', operator: operators[0]?.value ?? '>', value: '' }]);
  };
  const removeCondition = (index: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  };
  const clearAll = () => {
    setConditions([{ metric: metrics[0]?.value ?? 'CSRT', operator: operators[0]?.value ?? '>', value: '' }]);
  };
  const persist = (next: SavedMetricFilter[]) => {
    setSaved(next);
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(next)); } catch { /* 存储不可用时仅保留内存态 */ }
    }
  };
  const saveCurrent = () => {
    const label = describe(conditions, metrics, operators) || '空条件';
    const item: SavedMetricFilter = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label, conditions: conditions.map((c) => ({ ...c })) };
    persist([item, ...saved]);
  };
  const removeSaved = (id: string) => persist(saved.filter((s) => s.id !== id));

  const conditionsWithValue = conditions.filter((c) => c.value !== '' && c.value !== null);

  const savedColumns: DataTableColumn<SavedMetricFilter>[] = [
    { key: 'label', header: '搜索条件', render: (s) => <span>{s.label}</span> },
    { key: 'actions', header: '操作', align: 'right', render: (s) => (
      <span className="flex justify-end gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={() => onApplySaved ? onApplySaved(s) : onApply(s.conditions)}>筛选</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => removeSaved(s.id)}>删除</Button>
      </span>
    ) },
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="指标筛选"
      description="按转化率、曝光量、ACOS、ROAS、花费、点击率等指标组合筛选"
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>关闭</Button>
          <Button type="button" variant="secondary" onClick={clearAll}>清除</Button>
          <Button type="button" variant="primary" onClick={() => onApply(conditionsWithValue)}>筛选</Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2" data-wimoor-features="metric-filter,add-condition,save-search,clear-all,apply-filter">
        <section aria-label="筛选条件" className="space-y-2">
          <h4 className="text-body font-semibold">筛选条件</h4>
          <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
            {conditions.map((c, index) => (
              <div key={index} className="flex items-center gap-2">
                <Select
                  aria-label="指标"
                  value={c.metric}
                  options={metrics.map((m) => ({ value: m.value, label: m.label }))}
                  onChange={(e) => {
                    const next = e.target.value;
                    update(index, { metric: next, value: '' });
                  }}
                />
                <Select
                  aria-label="运算符"
                  value={c.operator}
                  options={operators.map((o) => ({ value: o.value, label: o.label }))}
                  onChange={(e) => update(index, { operator: e.target.value })}
                />
                <span className="relative flex-1">
                  <Input
                    aria-label="数值"
                    type="number"
                    value={c.value}
                    onChange={(e) => update(index, { value: e.target.value })}
                    className={metricById.get(c.metric)?.percent ? 'pr-8' : undefined}
                  />
                  {metricById.get(c.metric)?.percent ? (
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-meta text-muted">%</span>
                  ) : null}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="删除条件"
                  disabled={index === 0}
                  onClick={() => removeCondition(index)}
                >
                  <X aria-hidden className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="ghost" onClick={addCondition}>
              <Plus aria-hidden className="mr-1 h-3.5 w-3.5" />添加筛选条件
            </Button>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-2">
            <Button type="button" variant="ghost" onClick={clearAll}>
              <Trash2 aria-hidden className="mr-1 h-3.5 w-3.5" />清空所有
            </Button>
            <Button type="button" variant="ghost" onClick={saveCurrent}>保存这次搜索</Button>
          </div>
        </section>

        <section aria-label="我的搜索条件" className="space-y-2">
          <h4 className="text-body font-semibold">我的搜索条件</h4>
          <div className="max-h-[360px] overflow-auto">
            <DataTable<SavedMetricFilter>
              columns={savedColumns}
              rows={saved}
              getRowKey={(s) => s.id}
              empty="暂无数据"
              ariaLabel="我的搜索条件"
            />
          </div>
        </section>
      </div>
    </Dialog>
  );
}

export default MetricFilterPopover;
