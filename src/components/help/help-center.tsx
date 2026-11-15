"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  LifeBuoy,
  MessageCircleQuestion,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Section, SectionHeader } from "@/components/ui/section";
import { cn } from "@/lib/utils";
import { helpArticleBodies } from "@/lib/help/articles";
import {
  findHelpArticle,
  findHelpCategory,
  featuredHelpArticleIds,
  helpArticles,
  helpCategories,
  type HelpArticleMeta,
} from "@/lib/help/catalog";
import { buildHelpSearchIndex, searchHelpArticles } from "@/lib/help/search";
import { HelpProse } from "./help-prose";

/**
 * 帮助中心。搜索、主题、文章详情都在这一页内切换，不改变地址，
 * 顶栏的「帮助」入口点开就是一个页签；`/help/<id>` 只用于从外部直接打开某篇文章。
 */
type HelpView =
  | { kind: "home" }
  | { kind: "category"; id: string }
  | { kind: "all" }
  | { kind: "article"; id: string }
  | { kind: "missing" };

const SUPPORT_ARTICLE_ID = "contact-support";

export function HelpCenter({ initialDocId }: { initialDocId?: string }) {
  const [view, setView] = useState<HelpView>(() => {
    if (!initialDocId) return { kind: "home" };
    return findHelpArticle(initialDocId) ? { kind: "article", id: initialDocId } : { kind: "missing" };
  });
  const [query, setQuery] = useState("");

  const searchIndex = useMemo(() => buildHelpSearchIndex(), []);
  const results = useMemo(() => searchHelpArticles(searchIndex, query), [searchIndex, query]);
  const approximate = results.some((result) => result.approximate);

  const go = useCallback((next: HelpView) => {
    setView(next);
    setQuery("");
    // 视图在同一个页签里切换，地址不变，滚动位置要自己拉回顶部。
    window.scrollTo({ top: 0 });
  }, []);

  const openArticle = useCallback((id: string) => go({ kind: "article", id }), [go]);

  return (
    <div className="w-full max-w-[1120px] space-y-4">
      {view.kind === "home" ? (
        <HelpHome
          query={query}
          onQueryChange={setQuery}
          results={results}
          approximate={approximate}
          onOpenArticle={openArticle}
          onOpenCategory={(id) => go({ kind: "category", id })}
          onOpenAll={() => go({ kind: "all" })}
        />
      ) : null}

      {view.kind === "all" ? (
        <HelpAll
          onOpenArticle={openArticle}
          onOpenCategory={(id) => go({ kind: "category", id })}
          onHome={() => go({ kind: "home" })}
        />
      ) : null}

      {view.kind === "category" ? (
        <HelpCategory
          categoryId={view.id}
          onOpenArticle={openArticle}
          onHome={() => go({ kind: "home" })}
        />
      ) : null}

      {view.kind === "article" ? (
        <HelpArticleView
          articleId={view.id}
          onOpenArticle={openArticle}
          onOpenCategory={(id) => go({ kind: "category", id })}
          onHome={() => go({ kind: "home" })}
        />
      ) : null}

      {view.kind === "missing" ? <HelpMissing onHome={() => go({ kind: "home" })} /> : null}
    </div>
  );
}

/* ------------------------------- 帮助首页 ------------------------------- */

function HelpHome({
  query,
  onQueryChange,
  results,
  approximate,
  onOpenArticle,
  onOpenCategory,
  onOpenAll,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  results: ReturnType<typeof searchHelpArticles>;
  approximate: boolean;
  onOpenArticle: (id: string) => void;
  onOpenCategory: (id: string) => void;
  onOpenAll: () => void;
}) {
  const searching = query.trim().length > 0;
  const featured = featuredHelpArticleIds
    .map((id) => findHelpArticle(id))
    .filter((article): article is HelpArticleMeta => Boolean(article));

  return (
    <>
      <Section>
        <div className="px-6 py-6">
          <h2 className="text-title text-foreground">你想解决什么问题？</h2>
          <p className="mt-1 text-meta text-muted">
            粒粒的功能说明、连接步骤和数据口径，都在这一个页面里。
          </p>
          <HelpSearchInput value={query} onChange={onQueryChange} />
          <p className="mt-2 text-meta text-muted">
            {helpCategories.length} 个主题 · {helpArticles.length} 篇文档 · 文章目前以中文提供，可使用中英文功能名搜索。
          </p>
        </div>
      </Section>

      {searching ? (
        <Section>
          <SectionHeader
            title={`“${query.trim()}”的搜索结果`}
            description={`${results.length} 篇相关文档${approximate ? " · 已包含近似匹配结果" : ""}`}
          />
          {results.length > 0 ? (
            <ul className="divide-y divide-border">
              {results.map((result) => (
                <li key={result.item.article.id}>
                  <ArticleRow article={result.item.article} onOpen={() => onOpenArticle(result.item.article.id)} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-semibold text-foreground">暂时没有找到相关帮助</p>
              <p className="mx-auto mt-1 max-w-[460px] text-meta text-muted">
                试试功能名或更短的关键词，例如「连接」「AWD」「积分」。也可以浏览全部文档，或通过页尾联系支持。
              </p>
              <button
                type="button"
                className="mt-4 text-sm font-semibold text-brand hover:underline"
                onClick={onOpenAll}
              >
                浏览全部文档
              </button>
            </div>
          )}
        </Section>
      ) : (
        <>
          <Section>
            <SectionHeader
              title="按主题找答案"
              description="从使用场景进入，比按功能名找更快"
              actions={
                <button
                  type="button"
                  className="text-xs font-semibold text-brand hover:underline"
                  onClick={onOpenAll}
                >
                  全部文档
                </button>
              }
            />
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {helpCategories.map((category) => {
                const count = helpArticles.filter((article) => article.category === category.id).length;

                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => onOpenCategory(category.id)}
                    className="group flex flex-col rounded-lg border border-border bg-surface p-4 text-left transition-colors hover:border-brand/40 hover:bg-surface-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-section text-foreground">{category.title}</span>
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                    </span>
                    <span className="mt-1 text-meta leading-5 text-muted">{category.description}</span>
                    <span className="mt-3 text-xs font-semibold text-brand">{count} 篇文档</span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section>
            <SectionHeader
              title="常见问题"
              description="被问得最多的连接、数据与计费问题"
              actions={
                <button
                  type="button"
                  className="text-xs font-semibold text-brand hover:underline"
                  onClick={onOpenAll}
                >
                  查看全部文档
                </button>
              }
            />
            <ul className="divide-y divide-border">
              {featured.map((article) => (
                <li key={article.id}>
                  <button
                    type="button"
                    onClick={() => onOpenArticle(article.id)}
                    className="group flex w-full items-center gap-3 px-6 py-3.5 text-left transition-colors hover:bg-surface-muted/60"
                  >
                    <MessageCircleQuestion className="h-4 w-4 shrink-0 text-brand/80" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground group-hover:text-brand">
                        {article.title}
                      </span>
                      <span className="mt-0.5 block truncate text-meta text-muted">{article.summary}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}

      <HelpSupportFooter onOpenArticle={onOpenArticle} />
    </>
  );
}

function HelpSearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative mt-4">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="搜索问题，例如：连上了没有工具、AWD 货件"
        aria-label="搜索帮助文章"
        className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted/80 focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      {value ? (
        <button
          type="button"
          aria-label="清空搜索"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------ 全部 / 分类 ------------------------------ */

function HelpAll({
  onOpenArticle,
  onOpenCategory,
  onHome,
}: {
  onOpenArticle: (id: string) => void;
  onOpenCategory: (id: string) => void;
  onHome: () => void;
}) {
  return (
    <>
      <HelpBreadcrumb items={[{ label: "全部文档" }]} onHome={onHome} />
      <Section>
        <SectionHeader title="全部文档" description={`共 ${helpArticles.length} 篇，按主题分组`} />
        <div className="divide-y divide-border">
          {helpCategories.map((category) => {
            const articles = helpArticles.filter((article) => article.category === category.id);

            return (
              <div key={category.id} className="px-6 py-4">
                <button
                  type="button"
                  onClick={() => onOpenCategory(category.id)}
                  className="group flex items-center gap-2 text-sm font-bold text-foreground hover:text-brand"
                >
                  {category.title}
                  <span className="text-meta font-normal text-muted">{articles.length} 篇</span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted group-hover:text-brand" />
                </button>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {articles.map((article) => (
                    <li key={article.id}>
                      <button
                        type="button"
                        onClick={() => onOpenArticle(article.id)}
                        className="w-full truncate rounded px-1.5 py-1 text-left text-sm text-foreground/85 hover:bg-surface-muted hover:text-brand"
                      >
                        {article.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Section>
      <HelpSupportFooter onOpenArticle={onOpenArticle} />
    </>
  );
}

function HelpCategory({
  categoryId,
  onOpenArticle,
  onHome,
}: {
  categoryId: string;
  onOpenArticle: (id: string) => void;
  onHome: () => void;
}) {
  const category = findHelpCategory(categoryId);
  const articles = category ? helpArticles.filter((article) => article.category === category.id) : [];

  if (!category) return <HelpMissing onHome={onHome} />;

  return (
    <>
      <HelpBreadcrumb items={[{ label: category.title }]} onHome={onHome} />
      <Section>
        <SectionHeader
          title={category.title}
          description={category.description}
          actions={<span className="text-xs font-semibold text-muted">{articles.length} 篇文档</span>}
        />
        <ul className="divide-y divide-border">
          {articles.map((article) => (
            <li key={article.id}>
              <ArticleRow article={article} onOpen={() => onOpenArticle(article.id)} />
            </li>
          ))}
        </ul>
      </Section>
      <HelpSupportFooter onOpenArticle={onOpenArticle} />
    </>
  );
}

function ArticleRow({ article, onOpen }: { article: HelpArticleMeta; onOpen: () => void }) {
  const category = findHelpCategory(article.category);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-start gap-3 px-6 py-3.5 text-left transition-colors hover:bg-surface-muted/60"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground group-hover:text-brand">{article.title}</span>
        <span className="mt-0.5 block text-meta leading-5 text-muted">{article.summary}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-2 text-meta text-muted">
          {article.kind ? <Badge tone="blue">{article.kind}</Badge> : null}
          {category ? <span>{category.title}</span> : null}
        </span>
      </span>
      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
    </button>
  );
}

/* -------------------------------- 文章详情 -------------------------------- */

function HelpArticleView({
  articleId,
  onOpenArticle,
  onOpenCategory,
  onHome,
}: {
  articleId: string;
  onOpenArticle: (id: string) => void;
  onOpenCategory: (id: string) => void;
  onHome: () => void;
}) {
  const article = findHelpArticle(articleId);
  const category = article ? findHelpCategory(article.category) : undefined;
  const body = helpArticleBodies[articleId] ?? "";
  const related = (article?.related ?? [])
    .map((id) => findHelpArticle(id))
    .filter((item): item is HelpArticleMeta => Boolean(item));

  if (!article) return <HelpMissing onHome={onHome} />;

  return (
    <>
      <HelpBreadcrumb
        items={[
          ...(category ? [{ label: category.title, onClick: () => onOpenCategory(category.id) }] : []),
          { label: article.title },
        ]}
        onHome={onHome}
      />

      <Section>
        <div className="px-6 py-6">
          <div className="flex flex-wrap items-center gap-2 text-meta text-muted">
            {article.kind ? <Badge tone="blue">{article.kind}</Badge> : null}
            {category ? <span>{category.title}</span> : null}
            {article.lastVerified ? <span>最近核对：{article.lastVerified}</span> : null}
          </div>
          <h2 className="mt-2 text-title text-foreground">{article.title}</h2>
          <p className="mt-1.5 text-sm leading-6 text-muted">{article.summary}</p>
        </div>
      </Section>

      <Section>
        <div className="max-w-[820px] px-6 py-6">
          <HelpProse markdown={body} />
        </div>
      </Section>

      {article.prompt ? (
        <Section>
          <SectionHeader
            title="可以这样问你的 AI"
            description="把这句话发给你已连接的 AI 客户端，它会带上对应工具"
            actions={<CopyPromptButton prompt={article.prompt} />}
          />
          <div className="px-6 py-4">
            <p className="rounded-lg border border-border bg-surface-muted/70 px-4 py-3 text-sm leading-7 text-foreground/85">
              {article.prompt}
            </p>
          </div>
        </Section>
      ) : null}

      {article.sources.length > 0 ? (
        <Section>
          <SectionHeader title="官方参考" />
          <ul className="divide-y divide-border">
            {article.sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-6 py-3 text-sm font-semibold text-foreground hover:bg-surface-muted/60 hover:text-brand"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-muted" />
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {related.length > 0 ? (
        <Section>
          <SectionHeader title="接下来你可能需要" />
          <ul className="divide-y divide-border">
            {related.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpenArticle(item.id)}
                  className="group flex w-full items-center gap-3 px-6 py-3 text-left hover:bg-surface-muted/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground group-hover:text-brand">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-meta text-muted">{item.summary}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted group-hover:text-brand" />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <HelpSupportFooter onOpenArticle={onOpenArticle} />
    </>
  );
}

function CopyPromptButton({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied("done");
      window.setTimeout(() => setCopied("idle"), 2000);
    } catch {
      setCopied("failed");
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-surface-muted"
    >
      {copied === "done" ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      {copied === "done" ? "已复制" : copied === "failed" ? "复制失败" : "复制提问"}
    </button>
  );
}

/* --------------------------------- 公共块 --------------------------------- */

function HelpBreadcrumb({
  items,
  onHome,
}: {
  items: Array<{ label: string; onClick?: () => void }>;
  onHome: () => void;
}) {
  return (
    <nav aria-label="文章位置" className="flex flex-wrap items-center gap-1.5 text-meta text-muted">
      <button
        type="button"
        onClick={onHome}
        className="inline-flex items-center gap-1 rounded font-semibold text-muted transition-colors hover:text-brand"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        帮助中心
      </button>
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="inline-flex items-center gap-1.5">
          <ChevronRight className="h-3 w-3 text-muted/70" />
          {item.onClick ? (
            <button type="button" onClick={item.onClick} className="font-semibold hover:text-brand">
              {item.label}
            </button>
          ) : (
            <span className={cn("max-w-[520px] truncate", index === items.length - 1 && "text-foreground")}>
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

function HelpSupportFooter({ onOpenArticle }: { onOpenArticle: (id: string) => void }) {
  return (
    <Section>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div className="flex items-center gap-2 text-sm text-muted">
          <LifeBuoy className="h-4 w-4 text-brand" />
          <span>这篇文章还有没说清楚的地方？</span>
        </div>
        <button
          type="button"
          onClick={() => onOpenArticle(SUPPORT_ARTICLE_ID)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          <Sparkles className="h-4 w-4" />
          联系支持
        </button>
      </div>
    </Section>
  );
}

function HelpMissing({ onHome }: { onHome: () => void }) {  return (
    <Section>
      <div className="px-6 py-16 text-center">
        <p className="text-title text-foreground">没有找到这篇文章</p>
        <p className="mx-auto mt-2 max-w-[460px] text-sm leading-6 text-muted">
          链接可能有误。你可以返回帮助首页搜索问题，或浏览全部文档继续找。
        </p>
        <button
          type="button"
          onClick={onHome}
          className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3.5 text-sm font-semibold text-foreground hover:bg-surface-muted"
        >
          <ArrowLeft className="h-4 w-4" />
          返回帮助首页
        </button>
      </div>
    </Section>
  );
}
