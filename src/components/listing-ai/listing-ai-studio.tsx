"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  History,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StudioInputForm, maxCompetitorImages, maxOwnImages } from "@/components/listing-ai/studio-input-form";
import { StudioResultPanel, type StudioTab } from "@/components/listing-ai/studio-result-panel";
import { getProviderLabel, type AiModelSettingsPublic } from "@/lib/ai-settings";
import { saveListingAiImageAsset } from "@/lib/listing-ai/image-assets";
import {
  compactStudioImage,
  emptyStudioInput,
  type StudioImage,
  type StudioImageIdea,
  type StudioImageRun,
  type StudioProductInput,
  type StudioResult,
  type StudioRewriteKind,
} from "@/lib/listing-ai/studio";
import {
  clearStudioDraft,
  createStudioHistoryEntry,
  formatHistoryTime,
  pushStudioHistory,
  readStudioDraft,
  readStudioHistory,
  removeStudioHistoryEntry,
  writeStudioDraft,
  writeStudioHistory,
  type StudioHistoryEntry,
} from "@/lib/listing-ai/studio-history";
import { imageGeneratorViews } from "@/lib/listing-ai/workspace-draft";
import { cn } from "@/lib/utils";

interface AiConfigResponse {
  text?: AiModelSettingsPublic;
  image?: AiModelSettingsPublic;
  error?: string;
}

function applyRewrite(result: StudioResult, kind: StudioRewriteKind, index: number, text: string) {
  if (kind === "title") {
    return {
      ...result,
      titles: result.titles.map((title, itemIndex) =>
        itemIndex === index ? { ...title, text, charCount: Array.from(text).length } : title,
      ),
    };
  }

  if (kind === "bullet") {
    return {
      ...result,
      bullets: result.bullets.map((bullet, itemIndex) =>
        itemIndex === index ? { ...bullet, text } : bullet,
      ),
    };
  }

  if (kind === "searchTerms") {
    return { ...result, searchTerms: text };
  }

  return { ...result, description: text };
}

export function ListingAiStudio() {
  const [input, setInput] = useState<StudioProductInput>(emptyStudioInput);
  const [competitorImages, setCompetitorImages] = useState<StudioImage[]>([]);
  const [ownImages, setOwnImages] = useState<StudioImage[]>([]);
  const [uploading, setUploading] = useState<"competitor" | "own" | "">("");
  const [result, setResult] = useState<StudioResult | null>(null);
  const [originalResult, setOriginalResult] = useState<StudioResult | null>(null);
  const [imageIdeas, setImageIdeas] = useState<StudioImageIdea[]>([]);
  const [imageRuns, setImageRuns] = useState<Record<number, StudioImageRun>>({});
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rewriting, setRewriting] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<StudioTab>("analysis");
  const [copied, setCopied] = useState("");
  const [config, setConfig] = useState<AiConfigResponse | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [history, setHistory] = useState<StudioHistoryEntry[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [generatedAt, setGeneratedAt] = useState("");

  useEffect(() => {
    setInput(readStudioDraft());
    setHistory(readStudioHistory());
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => writeStudioDraft(input), 400);

    return () => window.clearTimeout(timer);
  }, [input]);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);

    try {
      const response = await fetch("/api/listing-ai/studio");

      if (!response.ok) {
        throw new Error(`读取配置失败（${response.status}）`);
      }

      setConfig((await response.json()) as AiConfigResponse);
    } catch (configError) {
      setConfig({
        error: configError instanceof Error ? configError.message : "读取不到系统保存的 AI 配置。",
      });
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const update = useCallback(
    <K extends keyof StudioProductInput>(key: K, value: StudioProductInput[K]) => {
      setInput((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const textReady = Boolean(config?.text?.hasApiKey);
  const textModelLabel = config?.text
    ? `${getProviderLabel(config.text.provider)} · ${config.text.model}`
    : "";
  const imageModelLabel = config?.image
    ? `${getProviderLabel(config.image.provider)} · ${config.image.model}`
    : "";

  const checklist = useMemo(
    () => [
      {
        label: "已填产品名称（中文或英文）",
        done: Boolean(input.chineseName.trim() || input.englishName.trim()),
      },
      {
        label: "已填特点 / 参数 / 规格 至少一项",
        done: Boolean(
          input.features.trim() || input.parameters.trim() || input.specifications.trim(),
        ),
      },
      {
        label: "已上传参考图（生图需要竞品图或自有图）",
        done: competitorImages.length + ownImages.length > 0,
      },
    ],
    [input, competitorImages.length, ownImages.length],
  );

  async function handleUpload(files: FileList | null, target: "competitor" | "own") {
    if (!files?.length) return;

    const limit = target === "competitor" ? maxCompetitorImages : maxOwnImages;
    const current = target === "competitor" ? competitorImages : ownImages;
    const remain = limit - current.length;

    if (remain <= 0) {
      setError(`${target === "competitor" ? "竞品图" : "产品图"}最多 ${limit} 张。`);
      return;
    }

    const list = Array.from(files).slice(0, remain);
    const overflow = files.length > remain;
    const failed: string[] = [];
    let succeeded = 0;

    setUploading(target);
    setError("");

    for (const file of list) {
      try {
        const asset = await saveListingAiImageAsset(file);
        const item: StudioImage = {
          name: asset.name,
          url: asset.url ?? "",
          assetId: asset.id,
        };

        if (target === "competitor") {
          setCompetitorImages((prev) => [...prev, item].slice(0, limit));
        } else {
          setOwnImages((prev) => [...prev, item].slice(0, limit));
        }
        succeeded += 1;
      } catch (uploadError) {
        failed.push(
          `${file.name}：${uploadError instanceof Error ? uploadError.message : "上传失败"}`,
        );
      }
    }

    setUploading("");

    if (failed.length) {
      setError(`上传失败 ${failed.length} 张 —— ${failed.join("；")}`);
    } else {
      setError("");
    }

    const notes = [
      succeeded ? `已上传 ${succeeded} 张` : "",
      overflow ? `超出 ${limit} 张上限，只处理前 ${remain} 张` : "",
    ].filter(Boolean);
    setNotice(notes.join("；"));
  }

  function removeImage(target: "competitor" | "own", index: number) {
    if (target === "competitor") {
      setCompetitorImages((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    } else {
      setOwnImages((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    }
  }

  async function handleGenerate() {
    if (!input.chineseName.trim() && !input.englishName.trim()) {
      setError("请至少填写中文名称或英文名称。");
      return;
    }

    if (!input.features.trim() && !input.parameters.trim() && !input.specifications.trim()) {
      setError("产品特点、参数、规格至少填写一项，否则模型只能编造。");
      return;
    }

    setGenerating(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/listing-ai/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as { result?: StudioResult; error?: string };

      if (!response.ok || !data.result) {
        throw new Error(data.error || "生成失败。");
      }

      const nextResult = data.result;
      const nextIdeas = nextResult.imageIdeas ?? [];
      const entry = createStudioHistoryEntry({
        input,
        result: nextResult,
        imageIdeas: nextIdeas,
        competitorImages,
        ownImages,
        model: textModelLabel,
      });
      const nextHistory = pushStudioHistory(entry, history);

      setResult(nextResult);
      setOriginalResult(nextResult);
      setImageIdeas(nextIdeas);
      setImageRuns({});
      setActiveHistoryId(entry.id);
      setGeneratedAt(formatHistoryTime(entry.createdAt));
      setHistory(nextHistory);

      if (!writeStudioHistory(nextHistory)) {
        setNotice("本地历史存储空间不足，本次结果不会保留在历史里。");
      }

      const hasCompetitor = Boolean(
        input.competitorNames.trim() || input.competitorListing.trim(),
      );
      setTab(hasCompetitor ? "compare" : "analysis");
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "生成失败。");
    } finally {
      setGenerating(false);
    }
  }

  async function handleRewrite(
    kind: StudioRewriteKind,
    index: number,
    text: string,
    instruction: string,
  ) {
    const key = `${kind}-${index}`;
    setRewriting(key);
    setError("");

    try {
      const response = await fetch("/api/listing-ai/studio/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, text, instruction, context: input }),
      });
      const data = (await response.json()) as { text?: string; error?: string };

      if (!response.ok || !data.text) {
        throw new Error(data.error || "改写失败。");
      }

      setResult((current) => (current ? applyRewrite(current, kind, index, data.text!) : current));
      setNotice("已按指令改写，可点「还原」回到生成原文。");

      return true;
    } catch (rewriteError) {
      setError(rewriteError instanceof Error ? rewriteError.message : "改写失败。");
      return false;
    } finally {
      setRewriting("");
    }
  }

  async function handleGenerateImage(index: number) {
    const idea = imageIdeas[index];

    if (!idea) return;

    const references = [...ownImages, ...competitorImages];

    if (!references.length) {
      setError("请先上传竞品参考图（或自己的产品图），图片生成需要参考图。");
      return;
    }

    setImageRuns((prev) => ({
      ...prev,
      [index]: { loading: true, images: prev[index]?.images ?? [], error: "" },
    }));

    try {
      const productLine = [
        input.englishName.trim() || input.chineseName.trim(),
        input.features.trim().slice(0, 600),
      ]
        .filter(Boolean)
        .join(" — ");
      const prompt = [
        productLine ? `Product: ${productLine}` : "",
        `Shot plan: ${idea.prompt}`,
        idea.negativePrompt ? `Avoid: ${idea.negativePrompt}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const ownViews = ownImages.reduce<Record<string, StudioImage[]>>((views, image, imageIndex) => {
        const key = imageGeneratorViews[imageIndex]?.key ?? "front";
        views[key] = [...(views[key] ?? []), compactStudioImage(image)];
        return views;
      }, {});

      const response = await fetch("/api/listing-ai/generate-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          ownViews,
          competitorImages: competitorImages.map(compactStudioImage),
        }),
      });
      const data = (await response.json()) as { images?: StudioImage[]; error?: string };

      if (!response.ok || !data.images?.length) {
        throw new Error(data.error || "图片生成失败。");
      }

      const images = data.images;

      setImageRuns((prev) => ({
        ...prev,
        [index]: {
          loading: false,
          images: [...images, ...(prev[index]?.images ?? [])],
          error: "",
        },
      }));
    } catch (imageError) {
      setImageRuns((prev) => ({
        ...prev,
        [index]: {
          loading: false,
          images: prev[index]?.images ?? [],
          error: imageError instanceof Error ? imageError.message : "图片生成失败。",
        },
      }));
    }
  }

  async function handleGenerateAllImages() {
    if (!ownImages.length && !competitorImages.length) {
      setError("请先上传竞品参考图（或自己的产品图），图片生成需要参考图。");
      return;
    }

    const queue = imageIdeas
      .map((_, index) => index)
      .filter((index) => !imageRuns[index]?.images.length);

    if (!queue.length) {
      setError("六张图都已生成，如需重做请单张点击。");
      return;
    }

    let cursor = 0;
    const workerCount = Math.min(2, queue.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (cursor < queue.length) {
          const index = queue[cursor];
          cursor += 1;
          await handleGenerateImage(index);
        }
      }),
    );
  }

  async function handleExport() {
    if (!result) return;

    setExporting(true);
    setError("");

    try {
      const response = await fetch("/api/listing-ai/studio/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input,
          result,
          model: config?.text
            ? { provider: config.text.provider, model: config.text.model }
            : undefined,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "导出失败。");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const name =
        input.asin.trim() || input.englishName.trim() || input.chineseName.trim() || "listing";
      anchor.href = url;
      anchor.download = `Listing生成台-${name}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("已导出 Excel（含文案、竞品对比、图片方案和产品资料留痕）。");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "导出失败。");
    } finally {
      setExporting(false);
    }
  }

  async function copyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1400);
    } catch {
      setError("复制失败，请手动选中复制。");
    }
  }

  function loadHistoryEntry(entry: StudioHistoryEntry) {
    setInput({ ...emptyStudioInput, ...entry.input });
    setResult(entry.result);
    setOriginalResult(entry.result);
    setImageIdeas(entry.imageIdeas ?? entry.result.imageIdeas ?? []);
    setImageRuns({});
    setCompetitorImages(entry.competitorImages ?? []);
    setOwnImages(entry.ownImages ?? []);
    setActiveHistoryId(entry.id);
    setGeneratedAt(formatHistoryTime(entry.createdAt));
    setTab(
      entry.input.competitorNames?.trim() || entry.input.competitorListing?.trim()
        ? "compare"
        : "analysis",
    );
    setHistoryOpen(false);
    setError("");
    setNotice(`已载入 ${entry.label} 的生成记录（${formatHistoryTime(entry.createdAt)}）。`);
  }

  function deleteHistoryEntry(id: string) {
    const next = removeStudioHistoryEntry(history, id);

    setHistory(next);
    writeStudioHistory(next);

    if (activeHistoryId === id) {
      setActiveHistoryId("");
    }
  }

  function handleReset() {
    setInput(emptyStudioInput);
    setResult(null);
    setOriginalResult(null);
    setImageIdeas([]);
    setImageRuns({});
    setCompetitorImages([]);
    setOwnImages([]);
    setError("");
    setNotice("");
    setActiveHistoryId("");
    setGeneratedAt("");
    clearStudioDraft();
  }

  const filteredHistory = useMemo(() => {
    const keyword = historyQuery.trim().toLowerCase();

    if (!keyword) return history;

    return history.filter((entry) =>
      [entry.label, entry.model, entry.marketplace, formatHistoryTime(entry.createdAt)]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [history, historyQuery]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-3 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={textReady ? "green" : "red"}>
              {configLoading ? "文本模型 读取中…" : textReady ? `文本 ${textModelLabel}` : "文本模型未配置"}
            </Badge>
            <Badge tone={config?.image?.hasApiKey ? "blue" : "gray"}>
              {imageModelLabel ? `生图 ${imageModelLabel}` : "生图模型 读取中…"}
            </Badge>
            <Badge tone="gray">配置取自系统设置，页面不保存 Key</Badge>
            {config?.error ? (
              <button
                type="button"
                className="text-[11px] font-bold text-danger hover:underline"
                onClick={() => void loadConfig()}
              >
                {config.error} · 重试
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setHistoryOpen((current) => !current)}
              >
                <History className="h-3.5 w-3.5" />
                历史 {history.length}
              </Button>
              {historyOpen ? (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-20 cursor-default"
                    aria-label="关闭历史面板"
                    onClick={() => setHistoryOpen(false)}
                  />
                  <div className="absolute right-0 top-full z-30 mt-2 w-[320px] rounded-lg border border-border bg-white p-3 shadow-xl">
                    <div className="mb-2 flex items-center gap-2">
                      <div className="flex flex-1 items-center gap-1.5 rounded-md border border-border px-2">
                        <Search className="h-3.5 w-3.5 text-muted" />
                        <input
                          className="h-8 w-full bg-transparent text-xs outline-none"
                          value={historyQuery}
                          onChange={(event) => setHistoryQuery(event.target.value)}
                          placeholder="搜索商品 / 模型 / 日期"
                        />
                      </div>
                    </div>
                    <div className="max-h-[320px] space-y-1 overflow-y-auto">
                      {filteredHistory.length ? (
                        filteredHistory.map((entry) => (
                          <div
                            key={entry.id}
                            className={cn(
                              "group flex items-center gap-2 rounded-md border px-2 py-1.5",
                              entry.id === activeHistoryId
                                ? "border-brand/40 bg-brand/5"
                                : "border-transparent hover:bg-surface-muted",
                            )}
                          >
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left"
                              onClick={() => loadHistoryEntry(entry)}
                            >
                              <p className="truncate text-xs font-bold text-foreground">
                                {entry.label}
                              </p>
                              <p className="truncate text-[10px] text-muted">
                                {entry.marketplace} · {formatHistoryTime(entry.createdAt)}
                                {entry.model ? ` · ${entry.model}` : ""}
                              </p>
                            </button>
                            <button
                              type="button"
                              className="text-muted opacity-0 transition hover:text-danger group-hover:opacity-100"
                              onClick={() => deleteHistoryEntry(entry.id)}
                              aria-label={`删除 ${entry.label}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))
                      ) : (
                        <p className="px-2 py-6 text-center text-xs text-muted">
                          {history.length ? "没有匹配的记录" : "还没有生成历史"}
                        </p>
                      )}
                    </div>
                    <p className="mt-2 border-t border-border pt-2 text-[10px] leading-relaxed text-muted">
                      最近 {history.length} / 20 条，存在本机浏览器；清空表单不会删除历史。
                    </p>
                  </div>
                </>
              ) : null}
            </div>
            <Button size="sm" variant="ghost" onClick={handleReset}>
              <RotateCcw className="h-3.5 w-3.5" />
              清空表单
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="flex gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="leading-relaxed">{error}</span>
        </div>
      ) : null}

      {notice ? (
        <div className="flex gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-xs text-foreground">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          <span className="leading-relaxed">{notice}</span>
        </div>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <StudioInputForm
            input={input}
            onField={update}
            competitorImages={competitorImages}
            ownImages={ownImages}
            uploading={uploading}
            onUpload={handleUpload}
            onRemoveImage={removeImage}
          />

          <div className="sticky bottom-3 z-10">
            <Card className="border-brand/30 shadow-lg">
              <CardContent className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-foreground">
                    {generating
                      ? "正在生成标题、五点、描述与对比表…"
                      : result
                        ? "已生成，可继续调整后重新生成"
                        : "填完即可生成整套 Listing"}
                  </p>
                  <p className="truncate text-[11px] text-muted">
                    {textReady
                      ? `调用 ${textModelLabel}`
                      : "系统设置里还没有可用的文本模型 Key"}
                  </p>
                </div>
                <Button onClick={handleGenerate} disabled={generating}>
                  {generating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {generating ? "生成中…" : result ? "重新生成" : "生成标题与描述"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        <StudioResultPanel
          result={result}
          originalResult={originalResult}
          onChangeResult={(updater) => setResult((current) => (current ? updater(current) : current))}
          tab={tab}
          onTabChange={setTab}
          generating={generating}
          checklist={checklist}
          onGenerate={handleGenerate}
          onCopy={copyText}
          copied={copied}
          rewriting={rewriting}
          onRewrite={handleRewrite}
          imageIdeas={imageIdeas}
          onImageIdeaChange={(index, patch) =>
            setImageIdeas((prev) =>
              prev.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
            )
          }
          imageRuns={imageRuns}
          onGenerateImage={handleGenerateImage}
          onGenerateAllImages={handleGenerateAllImages}
          hasOwnImages={ownImages.length > 0}
          onExport={handleExport}
          exporting={exporting}
          modelLabel={textModelLabel}
          generationNote={generatedAt ? `${generatedAt} 生成` : ""}
        />
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        输入内容保存在本机浏览器草稿，生成结果保存在本机历史（最近 20 条）；图片上传后存到系统文件库。AI 只允许引用你填写的资料，缺数据会标
        NEEDS_DATA，不会补零或编造。
      </p>
    </div>
  );
}
