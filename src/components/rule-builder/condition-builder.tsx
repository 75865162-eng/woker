"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  Condition,
  ConditionDataSource,
  ConditionGroup,
  ConditionMetricKey,
  ConditionOperator,
  LogicalOperator,
} from "@/lib/types";

const dataSourceOptions: Array<{ value: ConditionDataSource; label: string }> = [
  { value: "bulk", label: "Bulk / Recent 近期数据" },
  { value: "overall", label: "Overall 所有日期广告数据" },
  { value: "comparison", label: "对比指标" },
  { value: "derived", label: "派生指标" },
  { value: "bid_validation", label: "Bid 安全校验" },
];

const metricOptions: Array<{ value: ConditionMetricKey; label: string; category: string }> = [
  { value: "impressions", label: "广告曝光量", category: "广告数据" },
  { value: "clicks", label: "广告点击量", category: "广告数据" },
  { value: "ctr", label: "广告点击率 CTR", category: "广告数据" },
  { value: "sales", label: "广告销售额", category: "广告数据" },
  { value: "spend", label: "广告花费", category: "广告数据" },
  { value: "acos", label: "ACOS", category: "广告数据" },
  { value: "orders", label: "广告订单量", category: "广告数据" },
  { value: "cvr", label: "广告转化率", category: "广告数据" },
  { value: "cpc", label: "CPC", category: "广告数据" },
  { value: "cpa", label: "CPA", category: "广告数据" },
  { value: "roas", label: "ROAS", category: "广告数据" },
  { value: "acots", label: "ACoTS", category: "广告数据" },
  { value: "asots", label: "ASoTS", category: "广告数据" },
  { value: "viewableImpressions", label: "可见展示次数", category: "广告数据" },
  { value: "topOfSearchShare", label: "搜索首页 Top Of Search 占比", category: "广告数据" },
  { value: "advertisedProductOrders", label: "本广告产品订单量", category: "广告数据" },
  { value: "otherProductOrders", label: "其他广告产品订单量", category: "广告数据" },
  { value: "orderShare", label: "单量占比", category: "派生字段" },
  { value: "isCoreKeyword", label: "是否核心词", category: "派生字段" },
  { value: "overallAcosDelta", label: "Overall ACOS - 整体 ACOS", category: "派生字段" },
];

const operatorOptions: Array<{ value: ConditionOperator; label: string }> = [
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "between", label: "区间" },
  { value: "increase_by", label: "增加超过" },
  { value: "decrease_by", label: "降低超过" },
];

export const sampleConditionGroup: ConditionGroup = {
  id: "builder-root",
  logic: "AND",
  conditions: [
    { id: "condition-1", dataSource: "comparison", metric: "acos", operator: "increase_by", value: 15 },
    { id: "condition-2", dataSource: "overall", metric: "impressions", operator: "lt", value: 100 },
  ],
};

function createConditionId() {
  return `condition-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createCondition(): Condition {
  return {
    id: createConditionId(),
    dataSource: "bulk",
    metric: "orders",
    operator: "gte",
    value: 1,
  };
}

function isConditionGroup(item: Condition | ConditionGroup): item is ConditionGroup {
  return "logic" in item;
}

function normalizeEditableGroup(group: ConditionGroup): ConditionGroup {
  return {
    ...group,
    conditions: group.conditions.flatMap((item) => (isConditionGroup(item) ? item.conditions : [item])),
  };
}

function parseNumberInput(value: string) {
  if (value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function ConditionBuilder({
  group = sampleConditionGroup,
  compact = false,
  onChange,
}: {
  group?: ConditionGroup;
  compact?: boolean;
  onChange?: (group: ConditionGroup) => void;
}) {
  const [editableGroup, setEditableGroup] = useState<ConditionGroup>(() => normalizeEditableGroup(group));

  useEffect(() => {
    setEditableGroup(normalizeEditableGroup(group));
  }, [group]);

  const applyGroupUpdate = (updater: (current: ConditionGroup) => ConditionGroup) => {
    setEditableGroup((current) => {
      const next = updater(current);
      onChange?.(next);
      return next;
    });
  };

  const groupedMetricOptions = useMemo(() => {
    return metricOptions.reduce<Map<string, Array<(typeof metricOptions)[number]>>>((map, option) => {
      const list = map.get(option.category) ?? [];
      list.push(option);
      map.set(option.category, list);
      return map;
    }, new Map());
  }, []);

  const updateCondition = (conditionId: string, patch: Partial<Condition>) => {
    applyGroupUpdate((current) => ({
      ...current,
      conditions: current.conditions.map((item) =>
        isConditionGroup(item) || item.id !== conditionId
          ? item
          : {
              ...item,
              ...patch,
            },
      ),
    }));
  };

  const removeCondition = (conditionId: string) => {
    applyGroupUpdate((current) => ({
      ...current,
      conditions: current.conditions.filter((item) => isConditionGroup(item) || item.id !== conditionId),
    }));
  };

  const visibleConditions = editableGroup.conditions.filter((item): item is Condition => !isConditionGroup(item));

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-brand px-2 py-1 text-xs font-bold text-white">IF</span>
          <select
            value={editableGroup.logic}
            onChange={(event) =>
              applyGroupUpdate((current) => ({ ...current, logic: event.target.value as LogicalOperator }))
            }
            className="h-8 rounded-md border border-border bg-white px-2 text-xs font-semibold text-foreground"
          >
            <option value="AND">AND</option>
            <option value="OR">OR</option>
          </select>
        </div>
        {!compact && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => applyGroupUpdate((current) => ({ ...current, conditions: [...current.conditions, createCondition()] }))}
          >
            <Plus className="h-4 w-4" />
            添加条件
          </Button>
        )}
      </div>
      <div className="space-y-2 border-l-2 border-brand/30 pl-3">
        {visibleConditions.map((item) => (
          <div
            key={item.id}
            className="grid gap-2 rounded-md border border-border bg-white p-2 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_110px_minmax(0,0.8fr)_36px]"
          >
            <select
              value={item.dataSource ?? "bulk"}
              onChange={(event) => updateCondition(item.id, { dataSource: event.target.value as ConditionDataSource })}
              className="h-9 min-w-0 rounded-md border border-border bg-white px-2 text-sm font-medium"
            >
              {dataSourceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={item.metric}
              onChange={(event) => updateCondition(item.id, { metric: event.target.value as ConditionMetricKey })}
              className="h-9 min-w-0 rounded-md border border-border bg-white px-2 text-sm font-medium"
            >
              {Array.from(groupedMetricOptions.entries()).map(([category, options]) => (
                <optgroup key={category} label={category}>
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select
              value={item.operator}
              onChange={(event) =>
                updateCondition(item.id, {
                  operator: event.target.value as ConditionOperator,
                  value: event.target.value === "between" ? undefined : item.value,
                  min: event.target.value === "between" ? item.min ?? 0 : undefined,
                  max: event.target.value === "between" ? item.max ?? 0 : undefined,
                })
              }
              className="h-9 rounded-md border border-border bg-white px-2 text-sm font-medium"
            >
              {operatorOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="flex min-w-0 items-center gap-2">
              {item.operator === "between" ? (
                <>
                  <input
                    className="h-9 w-full min-w-0 rounded-md border border-border px-2 text-sm"
                    value={item.min ?? ""}
                    onChange={(event) => updateCondition(item.id, { min: parseNumberInput(event.target.value) })}
                  />
                  <span className="shrink-0 text-muted">~</span>
                  <input
                    className="h-9 w-full min-w-0 rounded-md border border-border px-2 text-sm"
                    value={item.max ?? ""}
                    onChange={(event) => updateCondition(item.id, { max: parseNumberInput(event.target.value) })}
                  />
                </>
              ) : (
                <input
                  className="h-9 w-full min-w-0 rounded-md border border-border px-2 text-sm"
                  value={item.value ?? ""}
                  onChange={(event) => updateCondition(item.id, { value: parseNumberInput(event.target.value) })}
                />
              )}
            </div>
            <Button variant="ghost" size="icon" title="删除条件" onClick={() => removeCondition(item.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export { createCondition, createConditionId, normalizeEditableGroup };
