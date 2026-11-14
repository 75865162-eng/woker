"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Layers3,
  Loader2,
  RefreshCw,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnalysisCard, AnalysisList, ScoreTile } from "@/components/listing-ai/output-primitives";
import { CharMeter, inputClass, textareaClass } from "@/components/listing-ai/studio-fields";
import {
  countSearchTermBytes,
  formatStudioComparison,
  formatStudioCopy,
  studioScoreFields,
  studioSearchTermMaxBytes,
  studioTitleMaxChars,
  type StudioImageIdea,
  type StudioImageRun,
  type StudioResult,
  type StudioRewriteKind,
} from "@/lib/listing-ai/studio";
import { cn } from "@/lib/utils";

export type StudioTab = "analysis" | "copy" | "image" | "compare";

const tabDefs: Array<{ id: StudioTab; label: string }> = [
  { id: "analysis", label: "分析" },
  { id: "copy", label: "标题与描述" },
  { id: "image", label: "图片方案" },
  { id: "compare", label: "按项对比" },
];

function titleTypeLabel(type: StudioResult["titles"][number]["type"]) {
  if (type === "seo") return "SEO";
  if (type === "conversion") return "转化";
  return "均衡推荐";
}

function RewriteBar({
  open,
  busy,
  value,
  onChange,
  onCancel,
  onSubmit,
  placeholder,
}: {
  open: boolean;
  busy: boolean;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  placeholder: string;
}) {
  if (!open) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-brand/30 bg-brand/5 p-2">
      <input
        className={cn(inputClass, "h-8 min-w-[180px] flex-1 py-1 text-xs")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !busy) onSubmit();
        }}
      />
      <Button size="sm" onClick={onSubmit} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
        {busy ? "改写中…" : "改写"}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function StudioResultPanel({
  result,
  originalResult,
  onChangeResult,
  tab,
  onTabChange,
  generating,
  checklist,
  onGenerate,
  onCopy,
  copied,
  rewriting,
  onRewrite,
  imageIdeas,
  onImageIdeaChange,
  imageRuns,
  onGenerateImage,
  onGenerateAllImages,
  hasOwnImages,
  onExport,
  exporting,
  modelLabel,
  generationNote,
}: {
  result: StudioResult | null;
  originalResult: StudioResult | null;
  onChangeResult: (updater: (current: StudioResult) => StudioResult) => void;
  tab: StudioTab;
  onTabChange: (tab: StudioTab) => void;
  generating: boolean;
  checklist: Array<{ label: string; done: boolean }>;
  onGenerate: () => void;
  onCopy: (key: string, value: string) => void;
  copied: string;
  rewriting: string;
  onRewrite: (
    kind: StudioRewriteKind,
    index: number,
    text: string,
    instruction: string,
  ) => Promise<boolean>;
  imageIdeas: StudioImageIdea[];
  onImageIdeaChange: (index: number, patch: Partial<StudioImageIdea>) => void;
  imageRuns: Record<number, StudioImageRun>;
  onGenerateImage: (index: number) => void;
  onGenerateAllImages: () => void;
  hasOwnImages: boolean;
  onExport: () => void;
  exporting: boolean;
  modelLabel: string;
  generationNote: string;
}) {
  const [rewriteOpen, setRewriteOpen] = useState("");
  const [rewriteText, setRewriteText] = useState("");
  const [expandedPrompt, setExpandedPrompt] = useState<Record<number, boolean>>({});

  const compareStats = {
    total: result?.comparison.length ?? 0,
    missing: result?.comparison.filter((row) => row.status === "needs-data").length ?? 0,
  };
  const filled = compareStats.total - compareStats.missing;
  const imagesBusy = Object.values(imageRuns).some((run) => run.loading);

  function toggleRewrite(key: string) {
    setRewriteText("");
    setRewriteOpen((current) => (current === key ? "" : key));
  }

  async function submitRewrite(kind: StudioRewriteKind, index: number, text: string) {
    const ok = await onRewrite(kind, index, text, rewriteText);

    if (ok) setRewriteOpen("");
  }

  function updateTitle(index: number, text: string) {
    onChangeResult((current) => ({
      ...current,
      titles: current.titles.map((title, itemIndex) =>
        itemIndex === index
          ? { ...title, text, charCount: Array.from(text).length }
          : title,
      ),
    }));
  }

  function updateBullet(index: number, text: string) {
    onChangeResult((current) => ({
      ...current,
      bullets: current.bullets.map((bullet, itemIndex) =>
        itemIndex === index ? { ...bullet, text } : bullet,
      ),
    }));
  }

  const headerActions = (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        size="sm"
        variant="secondary"
        onClick={onExport}
        disabled={!result || exporting}
      >
        {exporting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        {exporting ? "导出中…" : "导出 Excel"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => result && onCopy("copy-all", formatStudioCopy(result))}
        disabled={!result}
      >
        {copied === "copy-all" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        复制全部
      </Button>
    </div>
  );

  return (
    <Card className="xl:sticky xl:top-4 xl:flex xl:max-h-[calc(100vh-7rem)] xl:flex-col">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>3 生成结果</CardTitle>
            <p className="mt-1 text-[11px] text-muted">
              {modelLabel ? `模型 ${modelLabel}` : "等待读取模型配置"}
              {generationNote ? ` · ${generationNote}` : ""}
            </p>
          </div>
          {headerActions}
        </div>
        {result ? (
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {tabDefs.map((item) => {
              const count =
                item.id === "copy"
                  ? result.titles.length + result.bullets.length
                  : item.id === "image"
                    ? imageIdeas.length
                    : item.id === "compare"
                      ? compareStats.total
                      : 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  className={cn(
                    "flex h-8 shrink-0 items-center gap-1 rounded-md px-3 text-xs font-bold transition",
                    tab === item.id
                      ? "bg-brand text-white"
                      : "text-muted hover:bg-surface-muted hover:text-foreground",
                  )}
                >
                  {item.label}
                  {count ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-[10px]",
                        tab === item.id ? "bg-white/20 text-white" : "bg-surface-muted text-muted",
                      )}
                    >
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
        {!result ? (
          <div className="flex min-h-[420px] flex-col items-center justify-center px-2 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10">
              <Layers3 className="h-6 w-6 text-brand" />
            </div>
            <h2 className="mt-4 text-lg font-black text-foreground">还没有生成结果</h2>
            <p className="mt-1 max-w-sm text-sm leading-6 text-muted">
              填完左侧产品资料后生成，产出标题、五点、描述、图片方案和竞品逐项对比表；每次生成都会存入历史，可随时回切。
            </p>

            <div className="mt-4 w-full max-w-sm space-y-1.5 rounded-md border border-border bg-surface-muted/50 p-3 text-left">
              {checklist.map((item) => (
                <div key={item.label} className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-full",
                      item.done ? "bg-success/15 text-success" : "bg-surface-muted text-muted",
                    )}
                  >
                    {item.done ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  </span>
                  <span className={item.done ? "text-foreground" : "text-muted"}>{item.label}</span>
                </div>
              ))}
            </div>

            <Button className="mt-4" onClick={onGenerate} disabled={generating}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating ? "生成中…" : "生成标题与描述"}
            </Button>
          </div>
        ) : null}

        {result && tab === "analysis" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {studioScoreFields.map((field) => (
                <ScoreTile key={field.id} label={field.label} value={result.scores[field.id]} />
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <AnalysisCard title="Position" content={result.aiAnalysis.position} tone="blue" />
              </div>
              <AnalysisList title="Strength" items={result.aiAnalysis.strength} tone="green" />
              <AnalysisList title="Weakness" items={result.aiAnalysis.weakness} tone="amber" />
              <AnalysisList title="Opportunity" items={result.aiAnalysis.opportunity} tone="blue" />
              <AnalysisList title="Risk" items={result.aiAnalysis.risk} tone="red" />
            </div>

            <div className="rounded-md border border-border bg-surface-muted/40 p-3">
              <div className="mb-1.5 flex items-center gap-2">
                <Badge tone={result.missingFacts.length ? "amber" : "green"}>
                  上架前必须补齐 {result.missingFacts.length}
                </Badge>
                <span className="text-[11px] text-muted">缺数据不会补零，也不会编造</span>
              </div>
              {result.missingFacts.length ? (
                <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-foreground">
                  {result.missingFacts.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">本次输入没有发现必须补齐的关键缺口。</p>
              )}
            </div>
          </div>
        ) : null}

        {result && tab === "copy" ? (
          <div className="space-y-5">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">标题候选</h3>
                <span className="text-[11px] text-muted">上限 {studioTitleMaxChars} 字符</span>
              </div>
              <div className="space-y-2">
                {result.titles.map((title, index) => {
                  const key = `title-${index}`;
                  return (
                    <div key={`${title.type}-${index}`} className="rounded-md border border-border bg-white p-3">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <Badge tone={title.type === "balanced" ? "green" : "blue"}>
                          {titleTypeLabel(title.type)}
                        </Badge>
                        <CharMeter value={title.charCount} max={studioTitleMaxChars} />
                        <div className="ml-auto flex items-center gap-2">
                          <button
                            type="button"
                            className="text-[11px] text-muted hover:text-brand"
                            onClick={() => toggleRewrite(key)}
                          >
                            改写
                          </button>
                          <button
                            type="button"
                            className="text-[11px] text-muted hover:text-brand"
                            onClick={() => onCopy(key, title.text)}
                          >
                            {copied === key ? "已复制" : "复制"}
                          </button>
                          {originalResult?.titles[index] &&
                          originalResult.titles[index].text !== title.text ? (
                            <button
                              type="button"
                              className="flex items-center gap-1 text-[11px] text-muted hover:text-brand"
                              onClick={() => updateTitle(index, originalResult.titles[index].text)}
                            >
                              <RefreshCw className="h-3 w-3" />
                              还原
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <textarea
                        className={cn(textareaClass, "min-h-[64px] text-sm font-semibold")}
                        value={title.text}
                        onChange={(event) => updateTitle(index, event.target.value)}
                      />
                      {title.reason ? (
                        <p className="mt-1 text-[11px] leading-relaxed text-muted">{title.reason}</p>
                      ) : null}
                      <RewriteBar
                        open={rewriteOpen === key}
                        busy={rewriting === key}
                        value={rewriteText}
                        onChange={setRewriteText}
                        onCancel={() => setRewriteOpen("")}
                        onSubmit={() => submitRewrite("title", index, title.text)}
                        placeholder="改写要求，例如：更短、突出免打孔"
                      />
                    </div>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">五点描述</h3>
                <span className="text-[11px] text-muted">每条都标了事实来源</span>
              </div>
              <div className="divide-y divide-border rounded-md border border-border bg-white">
                {result.bullets.map((bullet, index) => {
                  const key = `bullet-${index}`;
                  const needsData = bullet.sourceFact === "NEEDS_DATA";
                  return (
                    <div key={`${bullet.index}-${index}`} className="p-3">
                      <div className="flex gap-3">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">
                          {bullet.index}
                        </span>
                        <div className="min-w-0 flex-1">
                          <textarea
                            className={cn(textareaClass, "min-h-[72px] text-sm")}
                            value={bullet.text}
                            onChange={(event) => updateBullet(index, event.target.value)}
                          />
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                            {bullet.sellingPoint ? (
                              <span className="text-muted">卖点：{bullet.sellingPoint}</span>
                            ) : null}
                            <Badge tone={needsData ? "red" : "gray"}>
                              来源：{bullet.sourceFact}
                            </Badge>
                            <button
                              type="button"
                              className="text-muted hover:text-brand"
                              onClick={() => toggleRewrite(key)}
                            >
                              改写
                            </button>
                            <button
                              type="button"
                              className="text-muted hover:text-brand"
                              onClick={() => onCopy(key, bullet.text)}
                            >
                              {copied === key ? "已复制" : "复制"}
                            </button>
                            {originalResult?.bullets[index] &&
                            originalResult.bullets[index].text !== bullet.text ? (
                              <button
                                type="button"
                                className="flex items-center gap-1 text-muted hover:text-brand"
                                onClick={() => updateBullet(index, originalResult.bullets[index].text)}
                              >
                                <RefreshCw className="h-3 w-3" />
                                还原
                              </button>
                            ) : null}
                          </div>
                          <RewriteBar
                            open={rewriteOpen === key}
                            busy={rewriting === key}
                            value={rewriteText}
                            onChange={setRewriteText}
                            onCancel={() => setRewriteOpen("")}
                            onSubmit={() => submitRewrite("bullet", index, bullet.text)}
                            placeholder="改写要求，例如：更突出承重、少用形容词"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">产品描述</h3>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted">
                    {Array.from(result.description).length} 字符
                  </span>
                  <button
                    type="button"
                    className="text-[11px] text-muted hover:text-brand"
                    onClick={() => toggleRewrite("description-0")}
                  >
                    改写
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-muted hover:text-brand"
                    onClick={() => onCopy("description", result.description)}
                  >
                    {copied === "description" ? "已复制" : "复制"}
                  </button>
                  {originalResult && originalResult.description !== result.description ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[11px] text-muted hover:text-brand"
                      onClick={() =>
                        onChangeResult((current) => ({
                          ...current,
                          description: originalResult.description,
                        }))
                      }
                    >
                      <RefreshCw className="h-3 w-3" />
                      还原
                    </button>
                  ) : null}
                </div>
              </div>
              <textarea
                className={cn(textareaClass, "min-h-[180px] text-sm")}
                value={result.description}
                onChange={(event) =>
                  onChangeResult((current) => ({ ...current, description: event.target.value }))
                }
              />
              <RewriteBar
                open={rewriteOpen === "description-0"}
                busy={rewriting === "description-0"}
                value={rewriteText}
                onChange={setRewriteText}
                onCancel={() => setRewriteOpen("")}
                onSubmit={() => submitRewrite("description", 0, result.description)}
                placeholder="改写要求，例如：更场景化、压缩到 3 段"
              />
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">后台搜索词</h3>
                <CharMeter
                  value={countSearchTermBytes(result.searchTerms)}
                  max={studioSearchTermMaxBytes}
                  unit="字节"
                />
              </div>
              <input
                className={cn(inputClass, "font-mono text-xs")}
                value={result.searchTerms}
                onChange={(event) =>
                  onChangeResult((current) => ({ ...current, searchTerms: event.target.value }))
                }
              />
            </section>
          </div>
        ) : null}

        {result && tab === "image" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-muted/40 px-3 py-2">
              <p className="text-[11px] leading-relaxed text-muted">
                6 张图的拍摄方案。提示词可逐条修改后生成；生成走系统保存的生图模型。
              </p>
              <Button size="sm" onClick={onGenerateAllImages} disabled={imagesBusy || !imageIdeas.length}>
                {imagesBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                {imagesBusy ? "生成中…" : "批量生成全部"}
              </Button>
            </div>

            {!hasOwnImages ? (
              <div className="flex gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="leading-relaxed">
                  没有上传自有产品图。生成图只能作为构图与风格参考，不能直接当主图上架。
                </span>
              </div>
            ) : null}

            <div className="grid gap-3 lg:grid-cols-2">
              {imageIdeas.map((idea, index) => {
                const run = imageRuns[index];
                const expanded = Boolean(expandedPrompt[index]);
                return (
                  <div key={`${idea.slot}-${index}`} className="rounded-md border border-border bg-white p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge tone="blue">{idea.slot}</Badge>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                        {idea.theme || "未命名主题"}
                      </span>
                      <button
                        type="button"
                        className="text-muted hover:text-brand"
                        onClick={() =>
                          setExpandedPrompt((current) => ({ ...current, [index]: !expanded }))
                        }
                        aria-label={expanded ? "收起提示词" : "展开提示词"}
                      >
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </div>
                    {idea.sellingPoint ? (
                      <p className="mb-1.5 text-[11px] text-muted">卖点：{idea.sellingPoint}</p>
                    ) : null}

                    {expanded ? (
                      <div className="space-y-2">
                        <textarea
                          className={cn(textareaClass, "min-h-[96px] font-mono text-[11px]")}
                          value={idea.prompt}
                          onChange={(event) => onImageIdeaChange(index, { prompt: event.target.value })}
                        />
                        <input
                          className={cn(inputClass, "py-1 text-[11px]")}
                          value={idea.negativePrompt}
                          onChange={(event) =>
                            onImageIdeaChange(index, { negativePrompt: event.target.value })
                          }
                          placeholder="负向提示词"
                        />
                      </div>
                    ) : (
                      <p className="line-clamp-2 font-mono text-[11px] leading-relaxed text-muted">
                        {idea.prompt}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onGenerateImage(index)}
                        disabled={run?.loading || imagesBusy}
                      >
                        {run?.loading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Wand2 className="h-3.5 w-3.5" />
                        )}
                        {run?.loading ? "生成中…" : "生成本张"}
                      </Button>
                      <button
                        type="button"
                        className="text-[11px] text-muted hover:text-brand"
                        onClick={() => onCopy(`prompt-${index}`, idea.prompt)}
                      >
                        {copied === `prompt-${index}` ? "已复制" : "复制提示词"}
                      </button>
                    </div>

                    {run?.error ? (
                      <p className="mt-2 text-[11px] leading-relaxed text-danger">{run.error}</p>
                    ) : null}

                    {run?.images.length ? (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {run.images.map((image, imageIndex) => (
                          <a
                            key={`${image.url}-${imageIndex}`}
                            href={image.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block aspect-square overflow-hidden rounded-md border border-border"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={image.url}
                              alt={image.name}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {result && tab === "compare" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green">可比项 {filled}</Badge>
              <Badge tone={compareStats.missing ? "amber" : "gray"}>
                缺竞品数据 {compareStats.missing}
              </Badge>
              <span className="text-[11px] text-muted">竞品列没有原文依据时标 NEEDS_DATA，不推测。</span>
              <button
                type="button"
                className="ml-auto text-[11px] text-muted hover:text-brand"
                onClick={() => onCopy("compare", formatStudioComparison(result))}
              >
                {copied === "compare" ? "已复制" : "复制表格"}
              </button>
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[760px] border-collapse text-xs">
                <thead>
                  <tr className="bg-surface-muted text-left">
                    <th className="sticky left-0 w-[104px] bg-surface-muted px-3 py-2 font-bold text-foreground">
                      项目
                    </th>
                    <th className="px-3 py-2 font-bold text-foreground">竞品</th>
                    <th className="px-3 py-2 font-bold text-foreground">我方方案</th>
                    <th className="px-3 py-2 font-bold text-foreground">差异</th>
                    <th className="px-3 py-2 font-bold text-foreground">建议动作</th>
                  </tr>
                </thead>
                <tbody>
                  {result.comparison.map((row, index) => (
                    <tr
                      key={`${row.dimension}-${index}`}
                      className={cn(
                        "border-t border-border align-top",
                        row.status === "needs-data" ? "bg-accent/5" : "bg-white",
                      )}
                    >
                      <td className="sticky left-0 bg-inherit px-3 py-2 font-bold text-foreground">
                        {row.dimension}
                      </td>
                      <td className="px-3 py-2 leading-relaxed">
                        {row.competitor === "NEEDS_DATA" ? (
                          <Badge tone="red">NEEDS_DATA</Badge>
                        ) : (
                          <span className="text-foreground">{row.competitor}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 leading-relaxed text-foreground">
                        {row.ours === "NEEDS_DATA" ? (
                          <Badge tone="red">NEEDS_DATA</Badge>
                        ) : (
                          row.ours
                        )}
                      </td>
                      <td className="px-3 py-2 leading-relaxed text-muted">{row.gap || "—"}</td>
                      <td className="px-3 py-2 leading-relaxed text-foreground">{row.action || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

