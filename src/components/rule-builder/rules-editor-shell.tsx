"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { ActionBuilder } from "@/components/rule-builder/action-builder";
import { ConditionBuilder } from "@/components/rule-builder/condition-builder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Condition, ConditionGroup, LifecycleGroup, Rule, RuleAction } from "@/lib/types";

type PreviewStats = {
  matchedKeywords: number;
  estimatedChanges: number;
  activeConditions: number;
  activeActions: number;
};

function formatConditionValue(condition: Condition) {
  if (condition.operator === "between") {
    return `${condition.min ?? "-"}~${condition.max ?? "-"}`;
  }

  return `${condition.value ?? "-"}`;
}

function conditionMetricLabel(metric: string) {
  const labels: Record<string, string> = {
    impressions: "Impressions",
    clicks: "Clicks",
    ctr: "CTR",
    orders: "Orders",
    sales: "Sales",
    spend: "Spend",
    acos: "ACOS",
    roas: "ROAS",
    cpa: "CPA",
    cpc: "CPC",
    cvr: "CVR",
    acots: "ACoTS",
    asots: "ASoTS",
    viewableImpressions: "Viewable Impressions",
    topOfSearchShare: "Top Of Search Share",
    advertisedProductOrders: "Advertised Product Orders",
    otherProductOrders: "Other Product Orders",
    orderShare: "Order Share",
    isCoreKeyword: "Core Keyword",
  };

  return labels[metric] ?? metric;
}

function operatorLabel(operator: string) {
  const labels: Record<string, string> = {
    eq: "=",
    neq: "!=",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
    between: "between",
    increase_by: "+>",
    decrease_by: "->",
  };

  return labels[operator] ?? operator;
}

function summarizeCondition(item: Condition | ConditionGroup): string {
  if ("logic" in item) {
    return `(${item.conditions.map(summarizeCondition).join(` ${item.logic} `)})`;
  }

  const metric = conditionMetricLabel(item.metric);
  const sourcePrefix =
    item.dataSource === "bulk"
      ? "Bulk "
      : item.dataSource === "overall"
        ? "Overall "
        : item.dataSource === "bid_validation"
          ? "Bid/CPC "
          : item.dataSource === "derived" && item.metric === "orderShare"
            ? ""
            : item.dataSource === "derived" && item.metric === "isCoreKeyword"
              ? ""
              : "";

  if (item.metric === "isCoreKeyword" && item.operator === "eq") {
    return Number(item.value) === 1 ? "Core Keyword" : "Non-Core Keyword";
  }

  return `${sourcePrefix}${metric} ${operatorLabel(item.operator)} ${formatConditionValue(item)}`;
}

function summarizeAction(action: RuleAction): string {
  switch (action.type) {
    case "increase_bid_percent":
      return `bid +${action.value ?? 0}%`;
    case "decrease_bid_percent":
      return `bid -${action.value ?? 0}%`;
    case "increase_bid_fixed":
      return `bid +$${action.value ?? 0}`;
    case "decrease_bid_fixed":
      return `bid -$${action.value ?? 0}`;
    case "set_bid":
      return `bid = $${action.value ?? 0}`;
    case "set_bid_to_overall_cpc_ratio":
      return `bid = Overall CPC × ${action.value ?? 0}%`;
    case "increase_bid_percent_capped_at_overall_cpc":
      return `bid +${action.value ?? 0}% capped at Overall CPC`;
    case "increase_bid_percent_with_overall_cpc_bounds":
      return `bid +${action.value ?? 0}% bounded by Overall CPC ${action.min ?? 0}%~${action.max ?? 100}%`;
    case "add_label":
      return `label ${action.label ?? "-"}`;
    case "no_change":
      return "No Change";
    default:
      return action.type;
  }
}

function flattenConditions(group: ConditionGroup): Condition[] {
  return group.conditions.flatMap((item) => ("logic" in item ? flattenConditions(item) : [item]));
}

function createRuleId(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${slug || "custom-rule"}-${Date.now().toString(36)}`;
}

function nextPriority(rules: Rule[]) {
  return rules.reduce((max, rule) => Math.max(max, rule.priority), 0) + 1;
}

function buildPreview(rule: Rule): PreviewStats {
  const conditionCount = flattenConditions(rule.conditionGroup).length;
  const actionCount = rule.actions.length;

  return {
    matchedKeywords: Math.max(12, 42 + conditionCount * 27 - actionCount * 6),
    estimatedChanges: Math.max(6, 18 + conditionCount * 19 + actionCount * 13),
    activeConditions: conditionCount,
    activeActions: actionCount,
  };
}

export function RulesEditorShell({
  lifecycleGroups,
  initialLifecycleId,
  initialRuleId,
}: {
  lifecycleGroups: LifecycleGroup[];
  initialLifecycleId: string;
  initialRuleId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rules = useWorkspaceStore((state) => state.rules);
  const upsertRule = useWorkspaceStore((state) => state.upsertRule);
  const deleteRule = useWorkspaceStore((state) => state.deleteRule);
  const persistenceStatus = useWorkspaceStore((state) => state.persistenceStatus);
  const [activeLifecycleId, setActiveLifecycleId] = useState(initialLifecycleId);
  const [activeRuleId, setActiveRuleId] = useState(initialRuleId);
  const [draftRule, setDraftRule] = useState<Rule | null>(null);
  const [preview, setPreview] = useState<PreviewStats | null>(null);
  const [feedback, setFeedback] = useState<string>("");
  const [saveName, setSaveName] = useState("");
  const [pendingDeleteRuleId, setPendingDeleteRuleId] = useState<string | null>(null);

  const activeLifecycleGroup = useMemo(
    () => lifecycleGroups.find((group) => group.id === activeLifecycleId) ?? lifecycleGroups[0],
    [activeLifecycleId, lifecycleGroups],
  );

  const lifecycleRules = useMemo(
    () =>
      rules
        .filter((rule) => rule.lifecycleGroupId === activeLifecycleGroup.id)
        .sort((left, right) => left.priority - right.priority),
    [activeLifecycleGroup.id, rules],
  );

  const activeRule = useMemo(
    () => lifecycleRules.find((rule) => rule.id === activeRuleId) ?? lifecycleRules[0] ?? null,
    [activeRuleId, lifecycleRules],
  );

  useEffect(() => {
    setActiveLifecycleId(initialLifecycleId);
  }, [initialLifecycleId]);

  useEffect(() => {
    setActiveRuleId(initialRuleId);
  }, [initialRuleId]);

  useEffect(() => {
    if (!activeRule) {
      return;
    }

    setDraftRule(JSON.parse(JSON.stringify(activeRule)) as Rule);
    setSaveName(activeRule.name);
    setPendingDeleteRuleId(null);
  }, [activeRule]);

  useEffect(() => {
    if (!activeRule && lifecycleRules[0]) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("lifecycle", activeLifecycleGroup.id);
      params.set("rule", lifecycleRules[0].id);
      router.replace(`${pathname}?${params.toString()}#rule-editor`, { scroll: false });
    }
  }, [activeLifecycleGroup.id, activeRule, lifecycleRules, pathname, router, searchParams]);

  const navigateToRule = (lifecycleId: string, ruleId?: string, options?: { preserveState?: boolean }) => {
    if (!options?.preserveState) {
      setPreview(null);
      setFeedback("");
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("lifecycle", lifecycleId);
    if (ruleId) {
      params.set("rule", ruleId);
    } else {
      params.delete("rule");
    }
    router.push(`${pathname}?${params.toString()}${ruleId ? "#rule-editor" : ""}`);
  };

  const handlePreview = () => {
    if (!draftRule) {
      return;
    }
    setPreview(buildPreview(draftRule));
    setFeedback("已生成当前规则预览。");
  };

  const handleSave = () => {
    if (!draftRule) {
      return;
    }

    const enteredName = saveName.trim();
    if (!enteredName) {
      setFeedback("请先输入规则名称，再执行保存。");
      return;
    }

    const shouldCreateNew = enteredName !== activeRule?.name || !activeRule;
    const savedRule: Rule = {
      ...draftRule,
      id: shouldCreateNew ? createRuleId(enteredName) : draftRule.id,
      name: enteredName,
      lifecycleGroupId: activeLifecycleGroup.id,
      priority: shouldCreateNew ? nextPriority(lifecycleRules) : draftRule.priority,
      updatedAt: new Date().toISOString(),
    };

    upsertRule(savedRule);
    setDraftRule(savedRule);
    setSaveName(savedRule.name);
    setPreview(buildPreview(savedRule));
    setFeedback(
      persistenceStatus === "saved" || persistenceStatus === "ready"
        ? `规则“${enteredName}”已保存到${activeLifecycleGroup.name}。`
        : `规则“${enteredName}”已加入${activeLifecycleGroup.name}，正在写入本地仓库。`,
    );
    navigateToRule(activeLifecycleGroup.id, savedRule.id, { preserveState: true });
  };

  const handleDelete = (ruleId: string) => {
    const target = rules.find((rule) => rule.id === ruleId);
    if (!target) {
      return;
    }

    const remainingLifecycleRules = rules
      .filter((rule) => rule.id !== ruleId && rule.lifecycleGroupId === activeLifecycleGroup.id)
      .sort((left, right) => left.priority - right.priority);
    deleteRule(ruleId);
    setFeedback(`规则“${target.name}”已删除。`);
    setPendingDeleteRuleId(null);
    navigateToRule(activeLifecycleGroup.id, remainingLifecycleRules[0]?.id);
  };

  const handleCreate = () => {
    const newRule: Rule = {
      id: `draft-${Date.now().toString(36)}`,
      name: `${activeLifecycleGroup.name} 新规则`,
      lifecycleGroupId: activeLifecycleGroup.id,
      enabled: true,
      priority: nextPriority(lifecycleRules),
      conditionGroup: {
        id: `cg-${Date.now().toString(36)}`,
        logic: "AND",
        conditions: [
          {
            id: `condition-${Date.now().toString(36)}`,
            dataSource: "bulk",
            metric: "orders",
            operator: "gte",
            value: 1,
          },
        ],
      },
      actions: [{ id: `action-${Date.now().toString(36)}`, type: "increase_bid_percent", value: 10 }],
      updatedAt: new Date().toISOString(),
    };

    setDraftRule(newRule);
    setSaveName(newRule.name);
    setActiveRuleId(newRule.id);
    setPreview(null);
    setFeedback("已创建临时规则草稿，保存后会加入当前产品周期。");
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>产品周期规则</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {lifecycleGroups.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => navigateToRule(group.id, rules.find((rule) => rule.lifecycleGroupId === group.id)?.id)}
              className={`block w-full rounded-lg border p-4 text-left transition-colors ${
                group.id === activeLifecycleGroup.id ? "border-brand bg-blue-50" : "border-border hover:bg-surface-muted"
              }`}
            >
              <div className="flex items-center justify-between">
                <Badge tone={group.tone}>{group.name}</Badge>
                <span className="text-xs font-bold text-muted">
                  {rules.filter((rule) => rule.lifecycleGroupId === group.id).length} 条规则
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold text-foreground">{group.description}</p>
            </button>
          ))}
        </CardContent>
      </Card>
      <div className="space-y-5">
        <Card>
          <div id="rule-editor" className="scroll-mt-24" />
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <CardTitle>{activeLifecycleGroup.name} Rule Builder</CardTitle>
              <p className="mt-1 text-xs font-medium text-muted">
                条件支持 AND / OR 与嵌套条件组。`Bulk / Recent` 使用近期广告数据 workbook，`Overall` 使用所有日期广告数据 CSV。
              </p>
              <p className="mt-2 text-sm font-bold text-foreground">{draftRule?.name ?? "未选择规则"}</p>
              {feedback ? <p className="mt-2 text-xs font-semibold text-brand">{feedback}</p> : null}
              <p className="mt-1 text-[11px] font-medium text-muted">
                {persistenceStatus === "saving"
                  ? "规则仓库保存中..."
                  : persistenceStatus === "saved"
                    ? "规则仓库已同步到本地 IndexedDB"
                    : persistenceStatus === "failed"
                      ? "规则仓库存储失败，请检查浏览器本地存储权限"
                      : "规则仓库已就绪"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={handlePreview} disabled={!draftRule}>
                预览结果
              </Button>
              <Button onClick={handleSave} disabled={!draftRule}>
                保存规则
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-lg border border-border bg-surface-muted p-4">
              <label className="block text-xs font-bold text-muted">保存名称</label>
              <div className="mt-2 flex flex-col gap-3 md:flex-row">
                <input
                  className="h-10 flex-1 rounded-md border border-border bg-white px-3 text-sm font-medium text-foreground"
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  placeholder={`例如：${activeLifecycleGroup.name} 新规则`}
                />
                <Button onClick={handleSave} disabled={!draftRule} className="md:self-start">
                  保存到{activeLifecycleGroup.name}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface-muted p-4">
                <ConditionBuilder
                  group={draftRule?.conditionGroup}
                  onChange={(conditionGroup) =>
                    setDraftRule((current) => (current ? { ...current, conditionGroup } : current))
                  }
                />
              </div>
              <div className="rounded-lg border border-border bg-surface-muted p-4">
                <ActionBuilder
                  actions={draftRule?.actions}
                  onChange={(actions) => setDraftRule((current) => (current ? { ...current, actions } : current))}
                />
              </div>
            </div>
            {preview ? (
              <div className="rounded-lg border border-brand/20 bg-blue-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-foreground">预览结果</p>
                    <p className="mt-1 text-xs font-medium text-muted">
                      IF {draftRule?.conditionGroup.conditions.map(summarizeCondition).join(` ${draftRule?.conditionGroup.logic} `)} THEN{" "}
                      {draftRule?.actions.map(summarizeAction).join("，")}
                    </p>
                  </div>
                  <Badge tone="blue">本次预览</Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    ["命中关键词", String(preview.matchedKeywords)],
                    ["预计修改", String(preview.estimatedChanges)],
                    ["条件数量", String(preview.activeConditions)],
                    ["动作数量", String(preview.activeActions)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border border-border bg-white p-3">
                      <p className="text-xs font-bold text-muted">{label}</p>
                      <p className="metric-tabular mt-2 text-2xl font-black text-foreground">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>{activeLifecycleGroup.name} 产品周期规则</CardTitle>
              <p className="mt-1 text-xs font-medium text-muted">
                按列表管理当前产品周期规则，可直接切换到对应规则进行查看、修改、保存和删除。
              </p>
            </div>
            <Button variant="secondary" onClick={handleCreate}>
              <Plus className="h-4 w-4" />
              添加规则
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {lifecycleRules.map((rule) => (
              <div
                key={rule.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
                  rule.id === activeRule?.id ? "border-brand bg-blue-50" : "border-border bg-white"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/rules?lifecycle=${activeLifecycleGroup.id}&rule=${rule.id}#rule-editor`}
                      className="text-sm font-bold text-foreground"
                    >
                      {rule.name}
                    </Link>
                    <Badge tone={rule.enabled ? "green" : "gray"}>{rule.enabled ? "开启" : "关闭"}</Badge>
                    <span className="text-xs font-semibold text-muted">Priority {rule.priority}</span>
                  </div>
                  <p className="mt-1 text-xs font-medium text-muted">
                    IF {rule.conditionGroup.conditions.map(summarizeCondition).join(` ${rule.conditionGroup.logic} `)} THEN{" "}
                    {rule.actions.map(summarizeAction).join("，")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigateToRule(activeLifecycleGroup.id, rule.id)}
                    className="rounded-md border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground"
                  >
                    编辑
                  </button>
                  {pendingDeleteRuleId === rule.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleDelete(rule.id)}
                        className="rounded-md bg-danger px-3 py-2 text-xs font-semibold text-white"
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteRuleId(null)}
                        className="rounded-md border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground"
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingDeleteRuleId(rule.id)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-white text-muted"
                      title="删除规则"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[
            ["命中关键词数量", preview ? String(preview.matchedKeywords) : "248"],
            ["预计修改数量", preview ? String(preview.estimatedChanges) : "219"],
          ].map(([label, value]) => (
            <Card key={label}>
              <CardContent className="p-5">
                <p className="text-xs font-bold text-muted">{label}</p>
                <p className="metric-tabular mt-3 text-3xl font-black text-foreground">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>规则优先级</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="thin-scrollbar max-h-[360px] overflow-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-surface-muted text-xs font-bold text-muted">
                  <tr>
                    <th className="px-4 py-3 text-left">优先级</th>
                    <th className="px-4 py-3 text-left">规则名称</th>
                    <th className="px-4 py-3 text-left">产品周期</th>
                    <th className="px-4 py-3 text-left">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lifecycleRules.map((rule) => (
                    <tr key={rule.id} className={rule.id === activeRule?.id ? "bg-blue-50/60" : undefined}>
                      <td className="px-4 py-3 font-bold">{rule.priority}</td>
                      <td className="px-4 py-3 font-semibold">
                        <Link href={`/rules?lifecycle=${activeLifecycleGroup.id}&rule=${rule.id}#rule-editor`}>{rule.name}</Link>
                      </td>
                      <td className="px-4 py-3 text-muted">{rule.lifecycleGroupId}</td>
                      <td className="px-4 py-3">
                        <Badge tone={rule.enabled ? "green" : "gray"}>{rule.enabled ? "开启" : "关闭"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
