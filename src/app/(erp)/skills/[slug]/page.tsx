import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { SkillRunWorkbench } from "@/components/skills/skill-run-workbench";
import { findSkillView, loadSkillBody } from "@/lib/skill-engine/config";
import { getAuthorizationContext } from "@/lib/auth/authorization-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { SKILL_MODULE_ID } from "@/lib/skill-engine/types";

export const dynamic = "force-dynamic";

export default async function SkillDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loaded = await loadSkillBody(slug);
  if (!loaded) notFound();

  const authorization = await getAuthorizationContext();
  if (!authorization) redirect(`/tiaotiao?next=${encodeURIComponent(`/skills/${slug}`)}`);
  if (!roleCanPerformAction(authorization.user.role, SKILL_MODULE_ID, "view", authorization.permissions)) {
    redirect("/forbidden");
  }

  const view = findSkillView(loaded.view.slug) ?? loaded.view;
  return (
    <AppShell title={view.name} subtitle={`${view.categoryLabel} · Skill 详情与运行`}>
      <div className="space-y-[var(--gap-section)]">
        <Link href="/skills" className="inline-block text-meta text-brand hover:underline">← 返回 Skill 库</Link>
        <section className="rounded-lg border border-border bg-surface p-[var(--pad-card)]">
          <div className="flex flex-wrap items-start gap-2">
            <h1 className="text-title font-semibold text-foreground">{view.name}</h1>
            <Badge tone="neutral">{view.categoryLabel}</Badge>
            {view.isNew ? <Badge tone="info">新</Badge> : null}
          </div>
          <p className="mt-2 text-body leading-6 text-muted">{view.summary}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <h2 className="mb-2 text-meta font-semibold text-muted">分析路径</h2>
              <ol className="list-decimal space-y-1 pl-5 text-body text-foreground">
                {view.steps.map((step, index) => <li key={index}>{step}</li>)}
              </ol>
            </div>
            <div>
              <h2 className="mb-2 text-meta font-semibold text-muted">能力说明</h2>
              <p className="text-body leading-6 text-foreground">
                本 Skill 基于本地已同步的数据快照分析，缺失数据标注 NEEDS_DATA；结论为建议，不会直接修改店铺。
                涉及写入的动作请前往对应的业务工作台，经审批后执行。
              </p>
              {view.tools.length ? (
                <p className="mt-2 break-all text-meta text-muted">关联工具：{view.tools.join("、")}</p>
              ) : null}
            </div>
          </div>
        </section>
        <SkillRunWorkbench skill={view} />
      </div>
    </AppShell>
  );
}
