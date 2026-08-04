import { AppShell } from "@/components/app-shell/app-shell";
import { RulesEditorShell } from "@/components/app-shell/lazy-workbenches";
import { DataSourceBanner } from "@/components/ui/data-source-banner";
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
    <AppShell title="规则中心" subtitle="产品生命周期规则与 IF / THEN 编辑器">
      <div className="space-y-5">
        <DataSourceBanner
          tone="local"
          title="规则仓库当前同步到本地工作区"
          description="规则会驱动 PPC 草稿生成，不直接覆盖原始文件；当前保存到浏览器 IndexedDB，后续迁移数据库时应保留规则版本、启用状态和审批记录。"
        />
        <RulesEditorShell
          lifecycleGroups={lifecycleGroups}
          initialLifecycleId={activeLifecycleGroup.id}
          initialRuleId={ruleParam}
        />
      </div>
    </AppShell>
  );
}
