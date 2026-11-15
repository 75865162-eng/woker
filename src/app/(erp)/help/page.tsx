import { AppShell } from "@/components/app-shell/app-shell";
import { HelpCenter } from "@/components/help/help-center";
import { helpArticles, helpCategories } from "@/lib/help/catalog";

export const metadata = {
  title: "帮助中心 · 粒粒",
};

export default function HelpPage() {
  return (
    <AppShell
      title="帮助中心"
      subtitle={`${helpCategories.length} 个主题 · ${helpArticles.length} 篇文档，连接、数据与广告问题都能在这里找到做法`}
    >
      <HelpCenter />
    </AppShell>
  );
}
