import { enrichMetric } from "@/lib/metrics";
import type {
  AdjustmentDraft,
  Condition,
  ConditionGroup,
  OptimizationEngine,
  OptimizationInput,
  PerformanceRow,
  OverallAdDataRow,
  Rule,
  RuleAction,
} from "@/lib/types";

type RuleEvaluationContext = {
  bulkRow: PerformanceRow;
  currentBid: number;
  overallRow?: OverallAdDataRow;
  campaignOverallRows: OverallAdDataRow[];
  totalOverallAcos?: number;
  orderShare?: number;
  isCoreKeyword: boolean;
};

function isConditionGroup(value: Condition | ConditionGroup): value is ConditionGroup {
  return "logic" in value;
}

function normalizeMatchValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeMatchType(value: string) {
  const normalized = normalizeMatchValue(value);
  const matchTypeMap: Record<string, string> = {
    exact: "exact",
    精准: "exact",
    phrase: "phrase",
    短语: "phrase",
    broad: "broad",
    广泛: "broad",
    "broad match": "broad",
    "phrase match": "phrase",
    "exact match": "exact",
  };

  return matchTypeMap[normalized] ?? normalized;
}

function buildKeywordMatchKey(keyword: string, matchType: string) {
  return `${normalizeMatchValue(keyword)}::${normalizeMatchType(matchType)}`;
}

function buildKeywordOnlyMatchKey(keyword: string) {
  return normalizeMatchValue(keyword);
}

function getBulkMatchKeys(row: PerformanceRow) {
  return Array.from(
    new Set([
      buildKeywordMatchKey(row.keyword, row.matchType),
      buildKeywordMatchKey(row.target, row.matchType),
    ]),
  );
}

function getBulkKeywordOnlyMatchKeys(row: PerformanceRow) {
  return Array.from(new Set([buildKeywordOnlyMatchKey(row.keyword), buildKeywordOnlyMatchKey(row.target)]));
}

function getOverallMetric(row: OverallAdDataRow | undefined, metric: string): number | undefined {
  if (!row) {
    return undefined;
  }

  switch (metric) {
    case "acos":
      return row.acos ?? (row.sales > 0 ? (row.spend / row.sales) * 100 : undefined);
    case "roas":
      return row.roas ?? (row.spend > 0 ? row.sales / row.spend : undefined);
    case "ctr":
      return row.impressions > 0 ? (row.clicks / row.impressions) * 100 : undefined;
    case "cpc":
      return row.cpc ?? (row.clicks > 0 ? row.spend / row.clicks : undefined);
    case "cvr":
      return row.clicks > 0 ? (row.orders / row.clicks) * 100 : undefined;
    case "cpa":
      return row.orders > 0 ? row.spend / row.orders : undefined;
    default:
      return Number(row[metric as keyof OverallAdDataRow] ?? 0);
  }
}

function getOverallCpc(row: OverallAdDataRow | undefined): number | undefined {
  return row?.cpc ?? (row && row.clicks > 0 ? row.spend / row.clicks : undefined);
}

function findOverallRow(row: PerformanceRow, overallRows: OverallAdDataRow[]) {
  const matchedRows = overallRows.filter(
    (overallRow) => overallRow.matchStatus === "matched" && overallRow.campaignGroupId === row.campaignGroupId,
  );
  const rowMatchKeys = getBulkMatchKeys(row);
  const rowKeywordOnlyMatchKeys = getBulkKeywordOnlyMatchKeys(row);

  return (
    matchedRows.find((overallRow) => rowMatchKeys.includes(buildKeywordMatchKey(overallRow.keyword, overallRow.matchType))) ??
    matchedRows.find((overallRow) => rowKeywordOnlyMatchKeys.includes(buildKeywordOnlyMatchKey(overallRow.keyword))) ??
    matchedRows[0]
  );
}

function calcOrderShare(overallRow: OverallAdDataRow | undefined, campaignOverallRows: OverallAdDataRow[]) {
  if (!overallRow) {
    return undefined;
  }

  const totalOrders = campaignOverallRows.reduce((sum, row) => sum + row.orders, 0);

  return totalOrders > 0 ? (overallRow.orders / totalOrders) * 100 : undefined;
}

function calcTotalOverallAcos(overallRows: OverallAdDataRow[]) {
  const matchedRows = overallRows.filter((row) => row.matchStatus === "matched");
  const totals = matchedRows.reduce(
    (sum, row) => ({
      spend: sum.spend + row.spend,
      sales: sum.sales + row.sales,
    }),
    { spend: 0, sales: 0 },
  );

  return totals.sales > 0 ? (totals.spend / totals.sales) * 100 : undefined;
}

function isCoreKeywordCandidate(row: PerformanceRow) {
  const normalizedCampaignName = row.campaignName.trim().toLowerCase();
  const normalizedAdGroupName = row.adGroupName.trim().toLowerCase();
  const normalizedMatchType = row.matchType.trim().toLowerCase();
  const normalizedTarget = row.target.trim().toLowerCase();

  return (
    normalizedCampaignName.includes("core") ||
    normalizedCampaignName.includes("核心") ||
    normalizedAdGroupName.includes("core") ||
    normalizedAdGroupName.includes("核心") ||
    (normalizedMatchType === "exact" && !normalizedTarget.startsWith("asin="))
  );
}

function getConditionActualValue(context: RuleEvaluationContext, condition: Condition): number | undefined {
  const dataSource = condition.dataSource ?? "bulk";

  if (dataSource === "overall") {
    return getOverallMetric(context.overallRow, condition.metric);
  }

  if (dataSource === "derived") {
    if (condition.metric === "orderShare") {
      return context.orderShare;
    }

    if (condition.metric === "isCoreKeyword") {
      return context.isCoreKeyword ? 1 : 0;
    }

    if (condition.metric === "overallAcosDelta") {
      const overallAcos = getOverallMetric(context.overallRow, "acos");

      return overallAcos !== undefined && context.totalOverallAcos !== undefined
        ? overallAcos - context.totalOverallAcos
        : undefined;
    }

    return undefined;
  }

  if (dataSource === "bid_validation") {
    const overallCpc = getOverallCpc(context.overallRow);

    if (!overallCpc || overallCpc <= 0) {
      return undefined;
    }

    if (condition.metric === "cpc") {
      return (context.currentBid / overallCpc) * 100;
    }

    return undefined;
  }

  if (dataSource === "comparison") {
    const bulkValue = enrichMetric(context.bulkRow, condition.compareMetric ?? condition.metric);
    const overallValue = getOverallMetric(context.overallRow, condition.metric);

    if (bulkValue === 0 || bulkValue === undefined || overallValue === undefined) {
      return undefined;
    }

    return ((overallValue - bulkValue) / Math.abs(bulkValue)) * 100;
  }

  return enrichMetric(context.bulkRow, condition.metric);
}

function evaluateCondition(context: RuleEvaluationContext, condition: Condition): boolean {
  const actual = getConditionActualValue(context, condition);

  if (actual === undefined || Number.isNaN(actual)) {
    return false;
  }

  switch (condition.operator) {
    case "eq":
      return actual === condition.value;
    case "neq":
      return actual !== condition.value;
    case "gt":
      return actual > Number(condition.value);
    case "gte":
      return actual >= Number(condition.value);
    case "lt":
      return actual < Number(condition.value);
    case "lte":
      return actual <= Number(condition.value);
    case "between":
      return actual >= Number(condition.min) && actual <= Number(condition.max);
    case "increase_by":
      return actual >= Number(condition.value);
    case "decrease_by":
      return actual <= -Math.abs(Number(condition.value));
    default:
      return false;
  }
}

export function evaluateConditionGroup(context: RuleEvaluationContext, group: ConditionGroup): boolean {
  const results = group.conditions.map((item) =>
    isConditionGroup(item) ? evaluateConditionGroup(context, item) : evaluateCondition(context, item),
  );

  return group.logic === "AND" ? results.every(Boolean) : results.some(Boolean);
}

function applyBidAction(currentBid: number, action: RuleAction, context?: RuleEvaluationContext): number {
  const value = Number(action.value ?? 0);

  switch (action.type) {
    case "increase_bid_percent":
      return currentBid * (1 + value / 100);
    case "decrease_bid_percent":
      return currentBid * (1 - value / 100);
    case "increase_bid_fixed":
      return currentBid + value;
    case "decrease_bid_fixed":
      return currentBid - value;
    case "set_bid":
      return value;
    case "set_bid_to_overall_cpc_ratio": {
      const overallCpc = getOverallCpc(context?.overallRow);

      return overallCpc ? overallCpc * (value / 100) : currentBid;
    }
    case "increase_bid_percent_capped_at_overall_cpc": {
      const overallCpc = getOverallCpc(context?.overallRow);
      const increasedBid = currentBid * (1 + value / 100);

      return overallCpc ? Math.min(increasedBid, overallCpc) : increasedBid;
    }
    default:
      return currentBid;
  }
}

function isBidValidationRule(rule: Rule) {
  return rule.id.includes("-bv-");
}

function buildReason(rule: Rule, action: RuleAction): string {
  const actionText: Record<string, string> = {
    increase_bid_percent: `竞价提高 ${action.value}%`,
    decrease_bid_percent: `竞价降低 ${action.value}%`,
    increase_bid_fixed: `竞价增加 $${action.value}`,
    decrease_bid_fixed: `竞价减少 $${action.value}`,
    set_bid: `设置固定竞价 $${action.value}`,
    set_bid_to_overall_cpc_ratio: `设置竞价为 Overall CPC 的 ${action.value}%`,
    increase_bid_percent_capped_at_overall_cpc: `竞价提高 ${action.value}%（不超过 Overall CPC）`,
    pause_keyword: "暂停关键词",
    enable_keyword: "启用关键词",
    add_negative_keyword: "添加否定关键词",
    add_label: `添加标签 ${action.label ?? ""}`,
    mark_pending: "标记待处理",
    no_change: "保持不变",
  };

  return `${rule.name}: ${actionText[action.type]}`;
}

function roundBid(value: number) {
  return Math.max(0.02, Number(value.toFixed(2)));
}

function createBidDraft(row: PerformanceRow, rule: Rule, action: RuleAction, context: RuleEvaluationContext): AdjustmentDraft {
  const rawBid = applyBidAction(context.currentBid, action, context);
  const suggestedBid = roundBid(rawBid);
  const deltaPercent =
    row.currentBid > 0 ? Number((((suggestedBid - row.currentBid) / row.currentBid) * 100).toFixed(1)) : 0;

  const draft: AdjustmentDraft = {
    id: `${row.id}-${rule.id}-${action.id}`,
    batchId: row.batchId,
    sheetName: row.sheetName,
    sourceRowIndex: row.sourceRowIndex,
    sourceRowNumber: row.sourceRowNumber,
    campaignGroupId: row.campaignGroupId,
    rowId: row.id,
    field: "bid",
    headerName: "竞价",
    oldValue: row.currentBid,
    newValue: suggestedBid,
    keyword: row.keyword,
    target: row.target,
    currentBid: row.currentBid,
    suggestedBid,
    deltaPercent,
    reason: buildReason(rule, action),
    matchedRule: rule.name,
    selected: true,
  };
  return draft;
}

function appendBidDraft(
  draft: AdjustmentDraft | undefined,
  row: PerformanceRow,
  rule: Rule,
  action: RuleAction,
  context: RuleEvaluationContext,
) {
  const nextDraft = createBidDraft(row, rule, action, context);

  if (!draft) {
    return nextDraft;
  }

  return {
    ...draft,
    id: `${draft.id}-${rule.id}-${action.id}`,
    newValue: nextDraft.newValue,
    suggestedBid: nextDraft.suggestedBid,
    deltaPercent: nextDraft.deltaPercent,
    reason: `${draft.reason} | ${nextDraft.reason}`,
    matchedRule: `${draft.matchedRule} + ${rule.name}`,
  };
}

function isBidAction(action: RuleAction) {
  return [
    "increase_bid_percent",
    "decrease_bid_percent",
    "increase_bid_fixed",
    "decrease_bid_fixed",
    "set_bid",
    "set_bid_to_overall_cpc_ratio",
    "increase_bid_percent_capped_at_overall_cpc",
  ].includes(action.type);
}

function shouldBlockFurtherRules(actions: RuleAction[]) {
  return actions.some((action) => action.type === "no_change");
}

export function runRuleEngine(input: OptimizationInput): AdjustmentDraft[] {
  const scopedRows = input.rows.filter((row) => row.campaignGroupId === input.campaignGroup.id);
  const overallAdDataRows = input.overallAdDataRows ?? [];
  const totalOverallAcos = calcTotalOverallAcos(overallAdDataRows);
  const rules = input.rules
    .filter((rule) => rule.enabled && rule.lifecycleGroupId === input.campaignGroup.lifecycleGroupId)
    .sort((a, b) => a.priority - b.priority);

  const drafts: AdjustmentDraft[] = [];
  const draftByRowId = new Map<string, AdjustmentDraft>();
  const touchedRows = new Set<string>();

  for (const rule of rules) {
    for (const row of scopedRows) {
      if (touchedRows.has(row.id)) {
        continue;
      }

      if (!isBidValidationRule(rule) && draftByRowId.has(row.id)) {
        touchedRows.add(row.id);
        continue;
      }

      const overallRow = findOverallRow(row, overallAdDataRows);
      const campaignOverallRows = overallAdDataRows.filter(
        (item) => item.matchStatus === "matched" && item.campaignGroupId === row.campaignGroupId,
      );
      const context = {
        bulkRow: row,
        currentBid: draftByRowId.get(row.id)?.suggestedBid ?? row.currentBid,
        overallRow,
        campaignOverallRows,
        totalOverallAcos,
        orderShare: calcOrderShare(overallRow, campaignOverallRows),
        isCoreKeyword: isCoreKeywordCandidate(row),
      };

      if (evaluateConditionGroup(context, rule.conditionGroup)) {
        const action = rule.actions.find(isBidAction);

        if (action) {
          const draft = appendBidDraft(draftByRowId.get(row.id), row, rule, action, context);

          draftByRowId.set(row.id, draft);
          if (!drafts.some((item) => item.rowId === row.id)) {
            drafts.push(draft);
          } else {
            const draftIndex = drafts.findIndex((item) => item.rowId === row.id);
            drafts[draftIndex] = draft;
          }

          if (isBidValidationRule(rule)) {
            continue;
          }

          touchedRows.add(row.id);
          continue;
        }

        if (shouldBlockFurtherRules(rule.actions)) {
          touchedRows.add(row.id);
        }
      }
    }
  }

  return drafts;
}

export const ruleOptimizationEngine: OptimizationEngine = {
  id: "rule-engine-v1",
  name: "规则优化引擎",
  run: runRuleEngine,
};
