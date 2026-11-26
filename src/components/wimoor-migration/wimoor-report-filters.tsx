'use client';

/**
 * WIMOOR 报表类「只读对照入口」页的可复用筛选栏。
 *
 * 目标：原版报表页（采购入库/付款/明细/时效/汇总/规划）普遍具备
 * 日期范围 + 搜索维度下拉 + 关键词 + 状态/账户/费用类型筛选。
 * 这些页面在本项目为只读对照入口（数据由等价页提供，不造数），
 * 但筛选交互本身应当真实可用、与原版一致，而不是静态 span。
 *
 * 本组件复用 src/components/ui/form-controls 的 Select/Input/DatePicker，
 * 一次实现，全站报表对照页共享。所有控件均为真实可交互控件，
 * 通过 onFilterChange 把当前筛选值回调给页面（可用于前端过滤或跳转等价页透传）。
 */
import { useMemo, useState } from 'react';
import { Input, Select, DatePicker } from '@/components/ui/form-controls';
import { Button } from '@/components/ui/button';
import { RotateCcw, RefreshCw } from 'lucide-react';

export interface ReportDimensionDef {
  key: string;
  label: string;
  placeholder?: string;
}

export interface ReportSelectFilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export interface WimoorReportFiltersConfig {
  /** 搜索维度下拉（如 SKU / 订单编号 / 供应商名称） */
  dimensions?: ReportDimensionDef[];
  /** 关键词输入框 placeholder */
  keywordPlaceholder?: string;
  /** 日期范围（开始/结束日期两个 DatePicker） */
  dateRange?: boolean;
  /** 日期标签，默认「开始日期 / 结束日期」 */
  dateLabels?: [string, string];
  /** 额外下拉筛选（仓库 / 付款账户 / 费用类型 / 状态等） */
  selectFilters?: ReportSelectFilterDef[];
  /** 筛选值变化回调 */
  onFilterChange?: (values: Record<string, string>) => void;
  /** 刷新按钮回调 */
  onRefresh?: () => void;
}

export interface ReportFilterValues {
  dimension: string;
  keyword: string;
  dateFrom: string;
  dateTo: string;
  [key: string]: string;
}

export function WimoorReportFilters({ config }: { config: WimoorReportFiltersConfig }) {
  const [dimension, setDimension] = useState(config.dimensions?.[0]?.key ?? '');
  const [keyword, setKeyword] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selects, setSelects] = useState<Record<string, string>>(() =>
    Object.fromEntries((config.selectFilters ?? []).map(f => [f.key, f.options[0]?.value ?? ''])),
  );

  const values = useMemo<ReportFilterValues>(() => ({
    dimension, keyword, dateFrom, dateTo, ...selects,
  }), [dimension, keyword, dateFrom, dateTo, selects]);

  const emit = (next: Partial<ReportFilterValues> = {}) => {
    const merged: Record<string, string> = { ...values };
    for (const [key, value] of Object.entries(next)) {
      if (typeof value === 'string') merged[key] = value;
      else delete merged[key];
    }
    config.onFilterChange?.(merged);
  };

  const reset = () => {
    setDimension(config.dimensions?.[0]?.key ?? '');
    setKeyword('');
    setDateFrom('');
    setDateTo('');
    setSelects(Object.fromEntries((config.selectFilters ?? []).map(f => [f.key, f.options[0]?.value ?? ''])));
    config.onFilterChange?.({});
  };

  const features = [
    ...(config.dimensions?.length ? ['搜索维度'] : []),
    '关键词',
    ...(config.dateRange ? ['开始日期', '结束日期'] : []),
    ...(config.selectFilters ?? []).map(f => f.label),
    '重置', '刷新',
  ].join('|');

  const dimOptions = (config.dimensions ?? []).map(d => ({ value: d.key, label: d.label }));
  const keywordPlaceholder = config.keywordPlaceholder
    ?? (config.dimensions?.find(d => d.key === dimension)?.placeholder || '请输入关键词');

  return (
    <div
      className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3"
      data-testid="wimoor-report-filters"
      data-wimoor-features={features}
      role="search"
    >
      {dimensionsBlock()}
      {config.dateRange ? dateRangeBlock() : null}
      {(config.selectFilters ?? []).map(f => selectBlock(f))}
      <div className="ml-auto flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={reset} aria-label="重置筛选">
          <RotateCcw size={13} className="mr-1" />重置
        </Button>
        <Button variant="secondary" size="sm" onClick={() => { config.onFilterChange?.(values); config.onRefresh?.(); }} aria-label="刷新">
          <RefreshCw size={13} className="mr-1" />刷新
        </Button>
      </div>
    </div>
  );

  function dimensionsBlock() {
    if (!config.dimensions?.length) return null;
    return (
      <>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted">搜索维度</span>
          <Select
            aria-label="搜索维度"
            value={dimension}
            options={dimOptions}
            onChange={(e) => { setDimension(e.target.value); emit({ dimension: e.target.value }); }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted">关键词</span>
          <Input
            aria-label="关键词"
            value={keyword}
            placeholder={keywordPlaceholder}
            onChange={(e) => { setKeyword(e.target.value); emit({ keyword: e.target.value }); }}
          />
        </label>
      </>
    );
  }

  function dateRangeBlock() {
    const [fromLabel, toLabel] = config.dateLabels ?? ['开始日期', '结束日期'];
    return (
      <>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted">{fromLabel}</span>
          <DatePicker aria-label={fromLabel} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); emit({ dateFrom: e.target.value }); }} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted">{toLabel}</span>
          <DatePicker aria-label={toLabel} value={dateTo} min={dateFrom || undefined} onChange={(e) => { setDateTo(e.target.value); emit({ dateTo: e.target.value }); }} />
        </label>
      </>
    );
  }

  function selectBlock(f: ReportSelectFilterDef) {
    return (
      <label className="flex flex-col gap-1 text-xs" key={f.key}>
        <span className="font-medium text-muted">{f.label}</span>
        <Select
          aria-label={f.label}
          value={selects[f.key] ?? ''}
          options={f.options}
          placeholder={f.placeholder}
          onChange={(e) => { setSelects(s => ({ ...s, [f.key]: e.target.value })); emit({ [f.key]: e.target.value }); }}
        />
      </label>
    );
  }
}
