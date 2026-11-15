import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell/app-shell";
import { HelpCenter } from "@/components/help/help-center";
import { findHelpArticle, findHelpCategory } from "@/lib/help/catalog";

/** 仅供从外部直接打开某篇文章（分享、历史链接）；站内浏览都在 /help 一个页签里完成。 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const article = findHelpArticle(slug);

  return { title: article ? `${article.title} · 帮助中心` : "帮助中心 · 粒粒" };
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = findHelpArticle(slug);
  const category = article ? findHelpCategory(article.category) : undefined;

  return (
    <AppShell
      title={article?.title ?? "帮助中心"}
      subtitle={category ? `${category.title} · ${article?.summary ?? ""}` : "没有找到这篇文章，可返回帮助首页重新查找"}
    >
      <HelpCenter initialDocId={slug} />
    </AppShell>
  );
}
