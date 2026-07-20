import { RulesEditorShell } from "@/components/rule-builder/rules-editor-shell";
import { AppShell } from "@/components/app-shell/app-shell";
import { lifecycleGroups } from "@/data/mock-data";

export default async function RulesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const lifecycleParam = Array.isArray(resolvedSearchParams.lifecycle)
    ? resolvedSearchParams.lifecycle[0]
    : resolvedSearchParams.lifecycle;
  const ruleParam = Array.isArray(resolvedSearchParams.rule) ? resolvedSearchParams.rule[0] : resolvedSearchParams.rule;
  const activeLifecycleGroup = lifecycleGroups.find((group) => group.id === lifecycleParam) ?? lifecycleGroups[0];

  return (
    <AppShell title="Rule Builder" subtitle="产品周期规则中心与 IF → THEN 编辑器">
      <RulesEditorShell
        lifecycleGroups={lifecycleGroups}
        initialLifecycleId={activeLifecycleGroup.id}
        initialRuleId={ruleParam}
      />
    </AppShell>
  );
}
