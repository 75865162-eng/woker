import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { AiChatWorkspace } from "@/components/ai-chat/ai-chat-workspace";
import { getAuthorizationContext } from "@/lib/auth/authorization-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { listSkills } from "@/lib/lili/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI 对话 · 经营分析" };

export default async function AiChatPage({ searchParams }: { searchParams: Promise<{ skill?: string }> }) {
  const authorization = await getAuthorizationContext();
  if (!authorization) redirect("/login?next=%2Fai%2Fchat");
  if (!roleCanPerformAction(authorization.user.role, "agents", "view", authorization.permissions)) {
    redirect("/forbidden?from=%2Fai%2Fchat");
  }
  const { skill } = await searchParams;
  const canCreate = roleCanPerformAction(authorization.user.role, "agents", "create", authorization.permissions);
  const locale = (await cookies()).get("lili_locale")?.value === "en" ? "en" : "zh";
  const skills = listSkills().map(s => ({
    slug: s.slug,
    name: s.nameZh ?? s.nameEn,
    summary: s.summaryZh ?? s.summaryEn,
    // 选中技能时自动填入输入框的问法，跟目录「复制 prompt」保持一致。
    prompt: locale === "en" ? s.promptEn : s.promptZh,
  }));
  return (
    <AppShell title="AI 对话" subtitle="自然语言提问 · 只读数据 · 来源可核对">
      <AiChatWorkspace
        initialSkillSlug={typeof skill === "string" ? skill.slice(0, 120) : undefined}
        skills={skills}
        canCreate={canCreate}
        locale={locale}
      />
    </AppShell>
  );
}
