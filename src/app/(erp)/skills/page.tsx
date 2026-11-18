import { AppShell } from "@/components/app-shell/app-shell";
import { SkillsGallery } from "@/components/skills/skills-gallery";
import { listSkillCategories, listSkillViews } from "@/lib/skill-engine/config";

export const metadata = { title: "Skill 智能工作台" };

export default function SkillsPage() {
  // Skill 目录是全局只读静态数据（来自 Lili catalog），不含租户数据，SSR 直出。
  // 仅「运行」需要工作区数据源，保留在 run API 内做 workspace 隔离校验。
  const skills = listSkillViews();
  const categories = listSkillCategories();
  return (
    <AppShell
      title="Skill 智能工作台"
      subtitle="运营技能库 · 一键运行 · 报告导出 · 数据来自本地快照与现有权限"
    >
      <SkillsGallery skills={skills} categories={categories} />
    </AppShell>
  );
}
