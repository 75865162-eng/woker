"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Download,
  Highlighter,
  History,
  ImageIcon,
  Layers3,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlignedPlaceholder,
  AmazonLinkButton,
  GalleryCell,
  ImagePreviewModal,
  ImageStrip,
  InfoField,
} from "@/components/listing-ai/gallery-primitives";
import { MiniUploader } from "@/components/listing-ai/image-upload-primitives";
import { ListingAiAplusPanel } from "@/components/listing-ai/listing-ai-aplus-panel";
import { ListingAiInputPanel } from "@/components/listing-ai/listing-ai-input-panel";
import {
  AnalysisSection,
  ImagePlanSection,
  ListingSection,
} from "@/components/listing-ai/listing-ai-output-panels";
import { ReviewHistorySection } from "@/components/listing-ai/review-history-section";
import {
  aiSettingsStorageKey,
  normalizeAiSettings,
  type AiModelSettings,
} from "@/lib/ai-settings";
import {
  blobToDataUrl,
  readListingAiImageAsset,
  saveListingAiImageAsset,
} from "@/lib/listing-ai/image-assets";
import {
  applyGalleryCellStyleToExcelCell,
  excelCellStyleToGalleryStyle,
  excelCellToText,
  galleryCellKey,
  imageExtension,
  mergeGalleryCellStyle,
  normalizeGalleryRedRanges,
  setExcelCellText,
} from "@/lib/listing-ai/gallery-excel";
import type {
  ListingOptimizationApiRequest,
  ListingOptimizationRequest,
  ListingOptimizationResult,
} from "@/lib/listing-ai/types";
import {
  buildCompetitorInfo,
  buildImageRequirements,
  createEmptyCompetitor,
  createPersistableDraft,
  defaultImageGeneratorPrompt,
  draftStorageKey,
  fieldClass,
  galleryCellStylesStorageKey,
  imageGeneratorViews,
  initialCompetitors,
  initialImageGenerator,
  initialInput,
  initialTitleGenerator,
  storageKey,
  type CompetitorDraft,
  type GalleryCellStyle,
  type GalleryInfoRow,
  type ImageGeneratorDraft,
  type ImagePreview,
  type OwnImageDraft,
  type SavedRecord,
  type TabId,
  type TitleGeneratorDraft,
  type TitleGeneratorField,
  type TitleGeneratorFieldKey,
  type TitleGeneratorHistoryRecord,
  type WorkspaceDraft,
} from "@/lib/listing-ai/workspace-draft";

const tabs = [
  { id: "input", label: "Title", icon: Search },
  { id: "visual", label: "Images & A+", icon: ImageIcon },
  { id: "analysis", label: "AI Analysis", icon: BarChart3 },
  { id: "listing", label: "Listing", icon: Sparkles },
  { id: "imagePlan", label: "Image Plan", icon: Layers3 },
  { id: "review", label: "Review & History", icon: History },
] as const;

async function hydrateImage(image: ImagePreview): Promise<ImagePreview> {
  if (image.url || !image.assetId) {
    return image;
  }

  try {
    const asset = await readListingAiImageAsset(image.assetId);
    if (!asset) {
      return image;
    }

    return {
      ...image,
      name: image.name || asset.name,
      url: await blobToDataUrl(asset.blob),
    };
  } catch (storageError) {
    console.warn("Failed to restore Listing AI image.", storageError);
    return image;
  }
}

async function hydrateImages(images: ImagePreview[] | undefined) {
  const hydratedImages = await Promise.all(
    (Array.isArray(images) ? images : []).map(hydrateImage),
  );

  return hydratedImages.filter((image) => image.url);
}

async function hydrateCompetitorDraft(competitor: CompetitorDraft) {
  return {
    ...competitor,
    mainImage: await hydrateImages(competitor.mainImage),
    screenshot: await hydrateImages(competitor.screenshot),
    images: await hydrateImages(competitor.images),
  };
}

async function hydrateOwnImageDraft(ownImages: OwnImageDraft) {
  return {
    ...ownImages,
    mainImage: await hydrateImages(ownImages.mainImage),
    images: await hydrateImages(ownImages.images),
  };
}

async function hydrateImageGeneratorDraft(draft: ImageGeneratorDraft) {
  const ownViews = { ...initialImageGenerator.ownViews };

  await Promise.all(
    imageGeneratorViews.map(async (view) => {
      ownViews[view.key] = await hydrateImages(draft.ownViews[view.key]);
    }),
  );

  return {
    ...draft,
    ownViews,
    competitorImages: await hydrateImages(draft.competitorImages),
    generatedImages: await hydrateImages(draft.generatedImages),
  };
}

export function ListingAiWorkbench() {
  const [activeTab, setActiveTab] = useState<TabId>("input");
  const [input, setInput] = useState(initialInput);
  const [competitors, setCompetitors] =
    useState<CompetitorDraft[]>(initialCompetitors);
  const [ownImages, setOwnImages] = useState<OwnImageDraft>({
    structureNotes: "",
    mainImage: [],
    images: [],
    imageNotes: [],
    sales: "",
    price: "",
    rating: "",
    reviewCount: "",
  });
  const [titleGenerator, setTitleGenerator] = useState<TitleGeneratorDraft>(
    initialTitleGenerator,
  );
  const [imageGenerator, setImageGenerator] = useState<ImageGeneratorDraft>(
    initialImageGenerator,
  );
  const [titlePromptOpen, setTitlePromptOpen] = useState(false);
  const [titleGenerating, setTitleGenerating] = useState(false);
  const [titleGeneratorError, setTitleGeneratorError] = useState("");
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageGeneratorError, setImageGeneratorError] = useState("");
  const [result, setResult] = useState<ListingOptimizationResult | null>(null);
  const [records, setRecords] = useState<SavedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [draftReady, setDraftReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function restoreDraft() {
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved && !cancelled) setRecords(JSON.parse(saved) as SavedRecord[]);

        const draft = window.localStorage.getItem(draftStorageKey);
        if (draft) {
          const parsed = JSON.parse(draft) as Partial<WorkspaceDraft>;
          if (parsed.input && !cancelled) setInput({ ...initialInput, ...parsed.input });
          if (parsed.competitors) {
            const restoredCompetitors = await Promise.all(
              initialCompetitors.map((emptyCompetitor, index) =>
                hydrateCompetitorDraft({
                  ...emptyCompetitor,
                  ...parsed.competitors?.[index],
                }),
              ),
            );
            if (!cancelled) setCompetitors(restoredCompetitors);
          }
          if (parsed.ownImages) {
            const emptyOwnImages: OwnImageDraft = {
              structureNotes: "",
              mainImage: [],
              images: [],
              imageNotes: [],
              sales: "",
              price: "",
              rating: "",
              reviewCount: "",
            };
            const restoredOwnImages = await hydrateOwnImageDraft({
              ...emptyOwnImages,
              ...parsed.ownImages,
            });
            if (!cancelled) setOwnImages(restoredOwnImages);
          }
          if (parsed.titleGenerator && !cancelled) {
            setTitleGenerator({
              ...initialTitleGenerator,
              ...parsed.titleGenerator,
              fields: initialTitleGenerator.fields.map((field) => ({
                ...field,
                ...parsed.titleGenerator?.fields?.find(
                  (savedField) => savedField.key === field.key,
                ),
              })),
              history: Array.isArray(parsed.titleGenerator.history)
                ? parsed.titleGenerator.history
                : [],
            });
          }
          if (parsed.imageGenerator) {
            const restoredImageGenerator = await hydrateImageGeneratorDraft({
              ...initialImageGenerator,
              ...parsed.imageGenerator,
              ownViews: {
                ...initialImageGenerator.ownViews,
                ...parsed.imageGenerator.ownViews,
              },
              competitorImages: Array.isArray(
                parsed.imageGenerator.competitorImages,
              )
                ? parsed.imageGenerator.competitorImages
                : [],
              generatedImages: Array.isArray(parsed.imageGenerator.generatedImages)
                ? parsed.imageGenerator.generatedImages
                : [],
              prompt: parsed.imageGenerator.prompt?.trim()
                ? parsed.imageGenerator.prompt
                : defaultImageGeneratorPrompt,
            });
            if (!cancelled) setImageGenerator(restoredImageGenerator);
          }
          if (parsed.activeTab && !cancelled) setActiveTab(parsed.activeTab);
        }
      } catch (storageError) {
        console.warn("Failed to restore Listing AI draft.", storageError);
        window.localStorage.removeItem(draftStorageKey);
      } finally {
        if (!cancelled) setDraftReady(true);
      }
    }

    void restoreDraft();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    const draft: WorkspaceDraft = {
      input,
      competitors,
      ownImages,
      titleGenerator,
      imageGenerator,
      activeTab,
    };
    try {
      window.localStorage.setItem(
        draftStorageKey,
        JSON.stringify(createPersistableDraft(draft)),
      );
    } catch (storageError) {
      console.warn("Failed to persist Listing AI draft.", storageError);
      window.localStorage.removeItem(draftStorageKey);
    }
  }, [
    activeTab,
    competitors,
    draftReady,
    imageGenerator,
    input,
    ownImages,
    titleGenerator,
  ]);

  const productName =
    input.asin ||
    input.productEnglishName ||
    input.productChineseName ||
    "Untitled Product";
  const productFactsCount = input.productFacts.trim().length;
  const canSubmit =
    input.asin.trim().length > 1 && productFactsCount >= 50 && !loading;
  const latestVersion =
    records.find((record) => record.productName === productName)?.version ?? 0;
  const competitorImageCount = competitors.reduce(
    (total, competitor) => total + competitor.images.length,
    0,
  );
  const ownImageCount = ownImages.images.length;
  const competitorInfo = useMemo(
    () => buildCompetitorInfo(competitors, ownImages.structureNotes),
    [competitors, ownImages.structureNotes],
  );
  const imageRequirements = useMemo(
    () =>
      buildImageRequirements(input.imageRequirements, competitors, ownImages),
    [input.imageRequirements, competitors, ownImages],
  );

  function update<K extends keyof ListingOptimizationRequest>(
    key: K,
    value: ListingOptimizationRequest[K],
  ) {
    setInput((current) => ({ ...current, [key]: value }));
  }

  function handleImageUpload(
    files: FileList | null,
    callback: (images: ImagePreview[]) => void,
  ) {
    const selected = Array.from(files ?? []).slice(0, 12);
    Promise.all(
      selected.map(async (file) => {
        try {
          const asset = await saveListingAiImageAsset(file);
          return {
            name: asset.name,
            url: await blobToDataUrl(asset.blob),
            assetId: asset.id,
          };
        } catch (storageError) {
          console.warn("Failed to save Listing AI image asset.", storageError);
          return new Promise<ImagePreview>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ name: file.name, url: String(reader.result || "") });
            reader.onerror = () =>
              resolve({ name: file.name, url: URL.createObjectURL(file) });
            reader.readAsDataURL(file);
          });
        }
      }),
    ).then(callback);
  }

  function updateTitleGeneratorField(
    key: TitleGeneratorFieldKey,
    patch: Partial<Pick<TitleGeneratorField, "value" | "weight">>,
  ) {
    setTitleGenerator((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.key === key ? { ...field, ...patch } : field,
      ),
    }));
  }

  function loadTitleGeneratorHistory(record: TitleGeneratorHistoryRecord) {
    setTitleGenerator((current) => ({
      ...current,
      fields: initialTitleGenerator.fields.map((field) => ({
        ...field,
        ...record.fields.find((savedField) => savedField.key === field.key),
      })),
      prompt: record.prompt,
      results: record.results,
    }));
    setTitleGeneratorError("");
  }

  async function handleGenerateTitles() {
    setTitleGenerating(true);
    setTitleGeneratorError("");

    const savedAiSettings = window.localStorage.getItem(aiSettingsStorageKey);
    const aiSettings = savedAiSettings
      ? normalizeAiSettings(
          JSON.parse(savedAiSettings) as Partial<AiModelSettings>,
        )
      : null;

    try {
      const response = await fetch("/api/listing-ai/generate-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...titleGenerator,
          aiSettings: aiSettings?.apiKey.trim() ? aiSettings : undefined,
        }),
      });
      const data = (await response.json()) as {
        results?: string[];
        error?: string;
      };

      if (!response.ok || !data.results?.length)
        throw new Error(data.error || "标题生成失败");

      const nextResults = data.results!.slice(0, 3);
      setTitleGenerator((current) => {
        const record: TitleGeneratorHistoryRecord = {
          id: crypto.randomUUID(),
          createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
          fields: current.fields.map((field) => ({ ...field })),
          prompt: current.prompt,
          results: nextResults,
        };

        return {
          ...current,
          results: nextResults,
          history: [record, ...current.history].slice(0, 30),
        };
      });
    } catch (err) {
      setTitleGeneratorError(
        err instanceof Error ? err.message : "标题生成失败",
      );
    } finally {
      setTitleGenerating(false);
    }
  }

  async function handleOptimize() {
    setLoading(true);
    setError("");

    const savedAiSettings = window.localStorage.getItem(aiSettingsStorageKey);
    const aiSettings = savedAiSettings
      ? normalizeAiSettings(
          JSON.parse(savedAiSettings) as Partial<AiModelSettings>,
        )
      : null;

    const payload: ListingOptimizationRequest = {
      ...input,
      productType: input.productType || input.productEnglishName || input.asin,
      competitorInfo,
      imageRequirements,
    };

    try {
      const response = await fetch("/api/listing-ai/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          aiSettings: aiSettings?.apiKey.trim() ? aiSettings : undefined,
        } satisfies ListingOptimizationApiRequest),
      });
      const data = (await response.json()) as {
        result?: ListingOptimizationResult;
        error?: string;
      };

      if (!response.ok || !data.result)
        throw new Error(data.error || "AI 优化失败");

      setResult(data.result);
      saveRecord(payload, data.result);
      setActiveTab("analysis");
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 优化失败");
    } finally {
      setLoading(false);
    }
  }

  function saveRecord(
    payload: ListingOptimizationRequest,
    nextResult: ListingOptimizationResult,
  ) {
    const version =
      (records.filter((record) => record.productName === productName).length ||
        0) + 1;
    const record: SavedRecord = {
      id: crypto.randomUUID(),
      version,
      createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      submitter: payload.submitter || "未填写",
      productName:
        payload.asin ||
        payload.productEnglishName ||
        payload.productChineseName ||
        payload.productType ||
        "未命名产品",
      input: payload,
      result: nextResult,
    };
    const nextRecords = [record, ...records].slice(0, 50);
    setRecords(nextRecords);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(nextRecords));
    } catch (storageError) {
      console.warn("Failed to persist Listing AI history.", storageError);
    }
  }

  function loadRecord(record: SavedRecord) {
    setInput(record.input);
    setResult(record.result);
    setActiveTab("analysis");
    setError("");
  }

  function resetDraft() {
    setInput(initialInput);
    setCompetitors(initialCompetitors);
    setOwnImages({
      structureNotes: "",
      mainImage: [],
      images: [],
      imageNotes: [],
      sales: "",
      price: "",
      rating: "",
      reviewCount: "",
    });
    setTitleGenerator(initialTitleGenerator);
    setImageGenerator(initialImageGenerator);
    setTitleGeneratorError("");
    setImageGeneratorError("");
    setResult(null);
    setActiveTab("input");
    setError("");
    window.localStorage.removeItem(draftStorageKey);
  }

  async function copyText(key: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1400);
  }

  async function handleRunImageGenerator() {
    const viewCount = imageGeneratorViews.reduce(
      (total, view) => total + imageGenerator.ownViews[view.key].length,
      0,
    );
    if (
      !viewCount ||
      !imageGenerator.competitorImages.length ||
      !imageGenerator.prompt.trim()
    ) {
      setImageGeneratorError("请先上传六视图、竞品图，并填写提示词。");
      return;
    }

    const savedAiSettings = window.localStorage.getItem(aiSettingsStorageKey);
    const aiSettings = savedAiSettings
      ? normalizeAiSettings(
          JSON.parse(savedAiSettings) as Partial<AiModelSettings>,
        )
      : null;

    setImageGenerating(true);
    setImageGeneratorError("");

    try {
      const response = await fetch("/api/listing-ai/generate-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...imageGenerator,
          aiSettings: aiSettings?.apiKey.trim() ? aiSettings : undefined,
        }),
      });
      const data = (await response.json()) as {
        images?: ImagePreview[];
        error?: string;
      };

      if (!response.ok || !data.images?.length) {
        throw new Error(data.error || "图片生成失败，请检查模型是否支持图片生成。");
      }

      setImageGenerator((current) => ({
        ...current,
        generatedImages: [...data.images!, ...current.generatedImages].slice(
          0,
          12,
        ),
        lastRunAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      }));
    } catch (error) {
      setImageGeneratorError(
        error instanceof Error ? error.message : "图片生成失败，请稍后重试。",
      );
    } finally {
      setImageGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_520px]">
          <div className="border-b border-border p-5 xl:border-b-0 xl:border-r">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">Listing Optimization Workspace</Badge>
              <Badge tone="green">Autosaved</Badge>
              <Badge tone="amber">Version {latestVersion || 1}</Badge>
              <Button size="sm" variant="secondary" onClick={resetDraft}>
                <RotateCcw className="h-4 w-4" />
                一键撤销输入
              </Button>
            </div>
            <h2 className="mt-4 text-2xl font-black leading-tight text-foreground md:text-3xl">
              {productName}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              一个工作区管理产品信息、竞品、图片图库、AI 分析、Listing、Image
              Plan、A+、AI Review 和历史版本。
            </p>
          </div>
          <div className="grid grid-cols-4 divide-x divide-border">
            <WorkspaceMetric label="Facts" value={`${productFactsCount}/50`} />
            <WorkspaceMetric
              label="Competitor Images"
              value={`${competitorImageCount}`}
            />
            <WorkspaceMetric label="Mine" value={`${ownImageCount}`} />
            <WorkspaceMetric
              label="AI Score"
              value={result ? `${result.score}` : "--"}
            />
          </div>
        </div>
      </section>

      <Card>
        <CardContent className="overflow-x-auto p-2">
          <div className="flex min-w-max gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  className={`flex h-10 items-center gap-2 rounded-md px-4 text-sm font-bold transition ${
                    active
                      ? "bg-brand text-white"
                      : "text-muted hover:bg-surface-muted hover:text-foreground"
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <main>
        {activeTab === "input" ? (
          <ListingAiInputPanel
            productFactsCount={productFactsCount}
            titleGenerator={titleGenerator}
            titleGenerating={titleGenerating}
            titleGeneratorError={titleGeneratorError}
            titlePromptOpen={titlePromptOpen}
            updateTitleGeneratorField={updateTitleGeneratorField}
            setTitleGenerator={setTitleGenerator}
            setTitlePromptOpen={setTitlePromptOpen}
            onGenerateTitles={handleGenerateTitles}
            onLoadTitleGeneratorHistory={loadTitleGeneratorHistory}
          />
        ) : null}
        {activeTab === "visual" ? (
          <VisualAplusSection
            competitors={competitors}
            ownImages={ownImages}
            setCompetitors={setCompetitors}
            setOwnImages={setOwnImages}
            input={input}
            update={update}
            error={error}
            canSubmit={canSubmit}
            loading={loading}
            onGenerate={handleOptimize}
            result={result}
            handleImageUpload={handleImageUpload}
          />
        ) : null}
        {activeTab === "analysis" ? (
          <AnalysisSection
            result={result}
            loading={loading}
            error={error}
            canSubmit={canSubmit}
            onGenerate={handleOptimize}
          />
        ) : null}
        {activeTab === "listing" ? (
          <ListingSection result={result} copied={copied} copyText={copyText} />
        ) : null}
        {activeTab === "imagePlan" ? (
          <ImagePlanSection
            result={result}
            copied={copied}
            copyText={copyText}
            imageGenerator={imageGenerator}
            imageGenerating={imageGenerating}
            imageGeneratorError={imageGeneratorError}
            setImageGenerator={setImageGenerator}
            handleImageUpload={handleImageUpload}
            onRunImageGenerator={handleRunImageGenerator}
          />
        ) : null}
        {activeTab === "review" ? (
          <ReviewHistorySection
            result={result}
            records={records}
            onLoad={loadRecord}
          />
        ) : null}
      </main>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CompetitorsSection({
  competitors,
  ownImages,
  input,
  update,
  updateCompetitor,
  setOwnImages,
  handleImageUpload,
}: {
  competitors: CompetitorDraft[];
  ownImages: OwnImageDraft;
  input: ListingOptimizationRequest;
  update: <K extends keyof ListingOptimizationRequest>(
    key: K,
    value: ListingOptimizationRequest[K],
  ) => void;
  updateCompetitor: (index: number, patch: Partial<CompetitorDraft>) => void;
  setOwnImages: React.Dispatch<React.SetStateAction<OwnImageDraft>>;
  handleImageUpload: (
    files: FileList | null,
    callback: (images: ImagePreview[]) => void,
  ) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Competitor Dashboard</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <div className="grid min-w-[1040px] grid-cols-4 gap-4">
          <MineColumn
            input={input}
            ownImages={ownImages}
            update={update}
            setOwnImages={setOwnImages}
            onImagesUpload={(files) =>
              handleImageUpload(files, (images) =>
                setOwnImages((current) => ({ ...current, images })),
              )
            }
          />

          {competitors.map((competitor, index) => (
            <CompetitorColumn
              key={index}
              label={`Competitor ${index + 1}`}
              asin={competitor.asin}
              mainImage={competitor.mainImage}
              title={competitor.title}
              bullets={competitor.bullets}
              targetAudience={competitor.targetAudience}
              useScenarios={competitor.useScenarios}
              productFeatures={competitor.productFeatures}
              opportunity={competitor.opportunity}
              screenshot={competitor.screenshot}
              images={competitor.images}
              onAsinChange={(value) => updateCompetitor(index, { asin: value })}
              onMainImageUpload={(files) =>
                handleImageUpload(files, (images) =>
                  updateCompetitor(index, { mainImage: images.slice(0, 1) }),
                )
              }
              onTitleChange={(value) =>
                updateCompetitor(index, { title: value })
              }
              onBulletsChange={(value) =>
                updateCompetitor(index, { bullets: value })
              }
              onTargetAudienceChange={(value) =>
                updateCompetitor(index, { targetAudience: value })
              }
              onUseScenariosChange={(value) =>
                updateCompetitor(index, { useScenarios: value })
              }
              onProductFeaturesChange={(value) =>
                updateCompetitor(index, { productFeatures: value })
              }
              onOpportunityChange={(value) =>
                updateCompetitor(index, { opportunity: value })
              }
              onScreenshotUpload={(files) =>
                handleImageUpload(files, (images) =>
                  updateCompetitor(index, { screenshot: images.slice(0, 1) }),
                )
              }
              onImagesUpload={(files) =>
                handleImageUpload(files, (images) =>
                  updateCompetitor(index, { images }),
                )
              }
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ImagesSection({
  competitors,
  ownImages,
  setCompetitors,
  setOwnImages,
  input,
  update,
  handleImageUpload,
}: {
  competitors: CompetitorDraft[];
  ownImages: OwnImageDraft;
  setCompetitors: React.Dispatch<React.SetStateAction<CompetitorDraft[]>>;
  setOwnImages: React.Dispatch<React.SetStateAction<OwnImageDraft>>;
  input: ListingOptimizationRequest;
  update: <K extends keyof ListingOptimizationRequest>(
    key: K,
    value: ListingOptimizationRequest[K],
  ) => void;
  handleImageUpload: (
    files: FileList | null,
    callback: (images: ImagePreview[]) => void,
  ) => void;
}) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [draggedImage, setDraggedImage] = useState<{
    column: "mine" | "competitor";
    columnIndex: number;
    imageIndex: number;
  } | null>(null);
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);
  const [excelError, setExcelError] = useState("");
  const [excelNotice, setExcelNotice] = useState("");
  const [focusedCellKey, setFocusedCellKey] = useState("");
  const [cellStyles, setCellStyles] = useState<Record<string, GalleryCellStyle>>({});
  const selectedTextRangeRef = useRef<{
    styleKey: string;
    range: { start: number; end: number };
  } | null>(null);
  const maxRows = Math.max(
    8,
    ...competitors.map((item) => item.images.length),
    ownImages.images.length,
  );
  const competitorColumns = competitors.map((competitor, index) => ({
    key: `competitor-${index}`,
    type: "competitor" as const,
    label: `Competitor ${index + 1}`,
    images: competitor.images,
    index,
  }));
  const mineColumn = {
    key: "mine",
    type: "mine" as const,
    label: "Mine",
    images: ownImages.images,
    index: -1,
  };
  const imageColumns = [...competitorColumns, mineColumn];
  const tableWidth = 144 + competitorColumns.length * 260 + 260;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(galleryCellStylesStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Record<string, GalleryCellStyle>;
      if (parsed && typeof parsed === "object") setCellStyles(parsed);
    } catch {
      window.localStorage.removeItem(galleryCellStylesStorageKey);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(galleryCellStylesStorageKey, JSON.stringify(cellStyles));
  }, [cellStyles]);

  function toggleFocusedCellStyle(styleKey: keyof GalleryCellStyle) {
    if (!focusedCellKey) return;
    setCellStyles((current) => {
      const currentStyle = current[focusedCellKey] ?? {};
      const nextStyle = { ...currentStyle, [styleKey]: !currentStyle[styleKey] };
      const next = { ...current };
      if (!nextStyle.redText && !nextStyle.yellowBg && !nextStyle.redRanges?.length) {
        delete next[focusedCellKey];
      } else {
        next[focusedCellKey] = nextStyle;
      }
      return next;
    });
  }

  function escapeHtml(value: string) {
    return value
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;")
      .replace(/'/gu, "&#39;");
  }

  function normalizedRedRanges(value: string, styleKey?: string) {
    return normalizeGalleryRedRanges(
      value,
      styleKey ? cellStyles[styleKey] : undefined,
    );
  }

  function richCellHtml(value: string, styleKey?: string) {
    const ranges = normalizedRedRanges(value, styleKey);
    if (!ranges.length) return escapeHtml(value);

    const parts: string[] = [];
    let cursor = 0;
    ranges.forEach((range) => {
      const start = Math.max(cursor, range.start);
      const end = Math.max(start, range.end);
      if (start > cursor) parts.push(escapeHtml(value.slice(cursor, start)));
      parts.push(
        `<span class="font-bold text-red-700">${escapeHtml(value.slice(start, end))}</span>`,
      );
      cursor = end;
    });
    if (cursor < value.length) parts.push(escapeHtml(value.slice(cursor)));
    return parts.join("");
  }

  function selectedRangeInFocusedCell() {
    if (!focusedCellKey) return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const editor = document.querySelector(
      `[data-gallery-cell-key="${CSS.escape(focusedCellKey)}"]`,
    );
    if (!editor) return null;
    const range = selection.getRangeAt(0);
    if (
      !editor.contains(range.startContainer) ||
      !editor.contains(range.endContainer)
    ) {
      return null;
    }

    const beforeStart = range.cloneRange();
    beforeStart.selectNodeContents(editor);
    beforeStart.setEnd(range.startContainer, range.startOffset);
    const beforeEnd = range.cloneRange();
    beforeEnd.selectNodeContents(editor);
    beforeEnd.setEnd(range.endContainer, range.endOffset);
    const start = beforeStart.toString().length;
    const end = beforeEnd.toString().length;
    return end > start ? { start, end } : null;
  }

  function markSelectedTextRed() {
    const selectedRange =
      selectedRangeInFocusedCell() ??
      (selectedTextRangeRef.current?.styleKey === focusedCellKey
        ? selectedTextRangeRef.current.range
        : null);
    if (!selectedRange) {
      toggleFocusedCellStyle("redText");
      return;
    }
    setCellStyles((current) => {
      const currentStyle = current[focusedCellKey] ?? {};
      return {
        ...current,
        [focusedCellKey]: {
          ...currentStyle,
          redRanges: [...(currentStyle.redRanges ?? []), selectedRange],
        },
      };
    });
    selectedTextRangeRef.current = null;
    window.getSelection()?.removeAllRanges();
  }

  function styleClasses(styleKey?: string) {
    const style = styleKey ? cellStyles[styleKey] : undefined;
    return [
      style?.redText ? "text-red-700 font-bold" : "text-foreground",
      style?.yellowBg ? "bg-yellow-100" : "bg-white",
    ].join(" ");
  }

  function setColumnImages(
    type: "mine" | "competitor",
    columnIndex: number,
    images: ImagePreview[],
  ) {
    if (type === "mine") {
      setOwnImages((current) => ({ ...current, images }));
      return;
    }

    setCompetitors((current) =>
      current.map((competitor, index) =>
        index === columnIndex ? { ...competitor, images } : competitor,
      ),
    );
  }

  function moveImage(
    type: "mine" | "competitor",
    columnIndex: number,
    fromIndex: number,
    toIndex: number,
  ) {
    const column = imageColumns.find(
      (item) => item.type === type && item.index === columnIndex,
    );
    if (!column || toIndex < 0 || toIndex >= column.images.length) {
      return;
    }

    const nextImages = [...column.images];
    const [movedImage] = nextImages.splice(fromIndex, 1);
    if (!movedImage) {
      return;
    }
    nextImages.splice(toIndex, 0, movedImage);
    setColumnImages(type, columnIndex, nextImages);
  }

  function handleDrop(
    type: "mine" | "competitor",
    columnIndex: number,
    targetIndex: number,
  ) {
    if (
      !draggedImage ||
      draggedImage.column !== type ||
      draggedImage.columnIndex !== columnIndex
    ) {
      setDraggedImage(null);
      return;
    }

    moveImage(type, columnIndex, draggedImage.imageIndex, targetIndex);
    setDraggedImage(null);
  }

  function addCompetitorColumn() {
    setCompetitors((current) => [...current, createEmptyCompetitor()]);
  }

  function removeCompetitorColumn() {
    setCompetitors((current) =>
      current.length > 1 ? current.slice(0, current.length - 1) : current,
    );
  }

  function updateImageNote(index: number, value: string) {
    setOwnImages((current) => {
      const imageNotes = [...(current.imageNotes ?? [])];
      imageNotes[index] = value;
      return { ...current, imageNotes };
    });
  }

  function updateOwnImagesField(
    key: keyof Pick<OwnImageDraft, "sales" | "price" | "rating" | "reviewCount">,
    value: string,
  ) {
    setOwnImages((current) => ({ ...current, [key]: value }));
  }

  function updateCompetitorField(
    columnIndex: number,
    key: keyof Pick<
      CompetitorDraft,
      | "asin"
      | "sales"
      | "price"
      | "variation"
      | "rating"
      | "reviewCount"
      | "title"
      | "productFeatures"
      | "aplus"
    >,
    value: string,
  ) {
    setCompetitors((current) =>
      current.map((competitor, index) =>
        index === columnIndex ? { ...competitor, [key]: value } : competitor,
      ),
    );
  }

  function getBulletLine(text: string, index: number) {
    return text.split(/\n/)[index] ?? "";
  }

  function updateBulletLine(text: string, index: number, value: string) {
    const lines = text.split(/\n/);
    while (lines.length <= index) {
      lines.push("");
    }
    lines[index] = value;
    return lines.join("\n").replace(/\n+$/u, "");
  }

  function updateCompetitorBullet(columnIndex: number, bulletIndex: number, value: string) {
    setCompetitors((current) =>
      current.map((competitor, index) =>
        index === columnIndex
          ? {
              ...competitor,
              bullets: updateBulletLine(competitor.bullets, bulletIndex, value),
            }
          : competitor,
      ),
    );
  }

  function renderAsinCell(
    value: string,
    onChange: (value: string) => void,
    styleKey: string,
  ) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_36px] gap-2">
        {renderTextCell(value, onChange, false, false, styleKey)}
        <AmazonLinkButton asin={value} />
      </div>
    );
  }

  function renderTextCell(
    value: string,
    onChange: (value: string) => void,
    multiline = false,
    tall = false,
    styleKey?: string,
  ) {
    const selectCell = () => {
      if (styleKey) setFocusedCellKey(styleKey);
    };
    const rememberSelection = () => {
      if (!styleKey) return;
      const range = selectedRangeInFocusedCell();
      if (range) selectedTextRangeRef.current = { styleKey, range };
    };

    return (
      <div
        role="textbox"
        aria-multiline={multiline}
        contentEditable
        suppressContentEditableWarning
        data-gallery-cell-key={styleKey}
        className={`${multiline ? (tall ? "h-[150px]" : "h-24") : "h-9"} w-full overflow-auto rounded-md border border-border px-2 py-1.5 text-xs leading-5 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10 ${multiline ? "whitespace-pre-wrap" : "whitespace-nowrap"} ${styleClasses(styleKey)}`}
        dangerouslySetInnerHTML={{ __html: richCellHtml(value, styleKey) }}
        onFocus={selectCell}
        onClick={selectCell}
        onMouseUp={rememberSelection}
        onKeyUp={rememberSelection}
        onInput={(event) => onChange(event.currentTarget.innerText.replace(/\n$/u, ""))}
        onKeyDown={(event) => {
          if (!multiline && event.key === "Enter") event.preventDefault();
        }}
      />
    );
  }

  const infoRows: GalleryInfoRow[] = [
    {
      label: "ASIN",
      mineValue: input.asin,
      updateMine: (value: string) => update("asin", value.trim()),
      competitorValue: (competitor: CompetitorDraft) => competitor.asin,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "asin", value.trim()),
      asin: true,
    },
    {
      label: "产品卖点",
      mineValue: input.mainSellingPoint1,
      updateMine: (value: string) => update("mainSellingPoint1", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.productFeatures,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "productFeatures", value),
      multiline: true,
    },
    {
      label: "销量",
      mineValue: ownImages.sales,
      updateMine: (value: string) => updateOwnImagesField("sales", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.sales,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "sales", value),
    },
    {
      label: "价格",
      mineValue: ownImages.price,
      updateMine: (value: string) => updateOwnImagesField("price", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.price,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "price", value),
    },
    {
      label: "变体",
      mineValue: input.variationInfo,
      updateMine: (value: string) => update("variationInfo", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.variation,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "variation", value),
    },
    {
      label: "星级",
      mineValue: ownImages.rating,
      updateMine: (value: string) => updateOwnImagesField("rating", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.rating,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "rating", value),
    },
    {
      label: "评论数",
      mineValue: ownImages.reviewCount,
      updateMine: (value: string) => updateOwnImagesField("reviewCount", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.reviewCount,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "reviewCount", value),
    },
    {
      label: "标题",
      mineValue: input.currentTitle,
      updateMine: (value: string) => update("currentTitle", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.title,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "title", value),
      multiline: true,
    },
    ...Array.from({ length: 6 }).map((_, index) => ({
      label: `5点${index + 1}`,
      mineValue: getBulletLine(input.currentBullets, index),
      updateMine: (value: string) =>
        update("currentBullets", updateBulletLine(input.currentBullets, index, value)),
      competitorValue: (competitor: CompetitorDraft) =>
        getBulletLine(competitor.bullets, index),
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorBullet(columnIndex, index, value),
      multiline: true,
      tall: true,
    })),
  ];

  const aplusRow = {
    label: "A+",
    mineValue: input.aplusRequirements,
    updateMine: (value: string) => update("aplusRequirements", value),
    competitorValue: (competitor: CompetitorDraft) => competitor.aplus,
    updateCompetitor: (columnIndex: number, value: string) =>
      updateCompetitorField(columnIndex, "aplus", value),
    multiline: true,
  };
  const imageRowLabels = Array.from({ length: maxRows }).map(
    (_, index) => `Image ${index + 1}`,
  );
  const excelRows = [...imageRowLabels, ...infoRows.map((row) => row.label), aplusRow.label];

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function handleExportGalleryExcel() {
    setExcelBusy(true);
    setExcelError("");
    setExcelNotice("");

    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Competitor Images Gallery");
      const dataColumns = [...competitorColumns, mineColumn];

      worksheet.columns = [
        { key: "label", width: 20 },
        ...dataColumns.map((column) => ({ key: column.key, width: 34 })),
      ];

      worksheet.getCell(1, 1).value = "";
      dataColumns.forEach((column, index) => {
        worksheet.getCell(1, index + 2).value = column.label;
      });

      excelRows.forEach((label, rowIndex) => {
        const rowNumber = rowIndex + 2;
        worksheet.getCell(rowNumber, 1).value = label;
        worksheet.getCell(rowNumber, 1).font = { bold: true };
      });

      infoRows.forEach((row, rowIndex) => {
        const rowNumber = imageRowLabels.length + rowIndex + 2;
        competitorColumns.forEach((column, columnIndex) => {
          const competitor = competitors[column.index];
          const cell = worksheet.getCell(rowNumber, columnIndex + 2);
          const styleKey = galleryCellKey(row.label, column.key);
          setExcelCellText(
            cell,
            competitor ? row.competitorValue(competitor) : "",
            cellStyles[styleKey],
          );
          applyGalleryCellStyleToExcelCell(
            cell,
            cellStyles[styleKey],
          );
        });
        const mineCell = worksheet.getCell(rowNumber, competitorColumns.length + 2);
        const mineStyleKey = galleryCellKey(row.label, mineColumn.key);
        setExcelCellText(mineCell, row.mineValue, cellStyles[mineStyleKey]);
        applyGalleryCellStyleToExcelCell(
          mineCell,
          cellStyles[mineStyleKey],
        );
        worksheet.getRow(rowNumber).height = row.tall ? 115 : row.multiline ? 72 : 28;
      });

      const aplusRowNumber = imageRowLabels.length + infoRows.length + 2;
      competitorColumns.forEach((column, columnIndex) => {
        const competitor = competitors[column.index];
        const cell = worksheet.getCell(aplusRowNumber, columnIndex + 2);
        const styleKey = galleryCellKey(aplusRow.label, column.key);
        setExcelCellText(
          cell,
          competitor ? aplusRow.competitorValue(competitor) : "",
          cellStyles[styleKey],
        );
        applyGalleryCellStyleToExcelCell(
          cell,
          cellStyles[styleKey],
        );
      });
      const aplusMineCell = worksheet.getCell(aplusRowNumber, competitorColumns.length + 2);
      const aplusMineStyleKey = galleryCellKey(aplusRow.label, mineColumn.key);
      setExcelCellText(
        aplusMineCell,
        aplusRow.mineValue,
        cellStyles[aplusMineStyleKey],
      );
      applyGalleryCellStyleToExcelCell(
        aplusMineCell,
        cellStyles[aplusMineStyleKey],
      );
      worksheet.getRow(aplusRowNumber).height = 72;

      imageRowLabels.forEach((_, imageIndex) => {
        const rowNumber = imageIndex + 2;
        worksheet.getRow(rowNumber).height = 150;
        worksheet.getCell(rowNumber, 1).value =
          `${imageRowLabels[imageIndex]}\n${ownImages.imageNotes?.[imageIndex] ?? ""}`.trim();

        dataColumns.forEach((column, columnIndex) => {
          const image = column.images[imageIndex];
          if (!image?.url?.startsWith("data:image/")) return;
          const imageId = workbook.addImage({
            base64: image.url,
            extension: imageExtension(image),
          });
          worksheet.addImage(imageId, {
            tl: { col: columnIndex + 1.08, row: rowNumber - 0.92 },
            ext: { width: 170, height: 140 },
          });
          worksheet.getCell(rowNumber, columnIndex + 2).value = image.name;
        });
      });

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = {
            top: { style: "thin", color: { argb: "FFE2E8F0" } },
            left: { style: "thin", color: { argb: "FFE2E8F0" } },
            bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
            right: { style: "thin", color: { argb: "FFE2E8F0" } },
          };
        });
      });

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).height = 28;
      worksheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];

      const buffer = await workbook.xlsx.writeBuffer();
      downloadBlob(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        `listing-ai-competitor-gallery-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (exportError) {
      setExcelError(exportError instanceof Error ? exportError.message : "Excel 导出失败。");
    } finally {
      setExcelBusy(false);
    }
  }

  async function handleImportGalleryExcel(file: File | null) {
    if (!file) return;
    setExcelBusy(true);
    setExcelError("");
    setExcelNotice("");

    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const worksheet = workbook.worksheets[0];
      if (!worksheet) throw new Error("Excel 中没有可读取的工作表。");

      const headers: string[] = [];
      worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber > 1) headers[colNumber] = excelCellToText(cell.value).trim();
      });
      const normalizedHeaders = headers.map((header) =>
        typeof header === "string" ? header.trim().toLowerCase() : "",
      );
      const competitorColumnNumbers = normalizedHeaders
        .map((header, colNumber) => ({ header, colNumber }))
        .filter(
          ({ header }) =>
            header.startsWith("competitor") || header.startsWith("竞品"),
        )
        .map(({ colNumber }) => colNumber);
      const importedCompetitorCount = competitorColumnNumbers.length;
      const detectedMineColNumber = normalizedHeaders.findIndex(
        (header) => header === "mine",
      );
      const mineColNumber = detectedMineColNumber > 0 ? detectedMineColNumber : 0;
      const nextCompetitors = Array.from(
        { length: Math.max(importedCompetitorCount, competitors.length, 3) },
        (_, index) => ({ ...createEmptyCompetitor(), ...competitors[index] }),
      );
      const nextOwnImages: OwnImageDraft = {
        ...ownImages,
        images: [...ownImages.images],
        imageNotes: [...(ownImages.imageNotes ?? [])],
      };
      const nextInput = { ...input };
      const nextCellStyles = { ...cellStyles };
      const rowByLabel = new Map<string, number>();
      const imageRowIndexByRowNumber = new Map<number, number>();
      worksheet.eachRow((row, rowNumber) => {
        const label = excelCellToText(row.getCell(1).value).split("\n")[0].trim();
        if (!label) return;
        rowByLabel.set(label, rowNumber);
        const imageMatch = /^(?:Image|主图)\s*(\d+)$/iu.exec(label);
        if (imageMatch) {
          imageRowIndexByRowNumber.set(rowNumber, Number(imageMatch[1]) - 1);
        }
      });

      function rowNumberForLabels(labels: string[]) {
        for (const label of labels) {
          const rowNumber = rowByLabel.get(label);
          if (rowNumber) return rowNumber;
        }
        return 0;
      }

      function readCell(labels: string | string[], colNumber: number) {
        const rowNumber = rowNumberForLabels(Array.isArray(labels) ? labels : [labels]);
        return rowNumber ? excelCellToText(worksheet.getCell(rowNumber, colNumber).value) : "";
      }

      function readCellStyle(labels: string | string[], colNumber: number) {
        const rowNumber = rowNumberForLabels(Array.isArray(labels) ? labels : [labels]);
        return rowNumber
          ? excelCellStyleToGalleryStyle(worksheet.getCell(rowNumber, colNumber))
          : {};
      }

      function imageLabels(imageIndex: number) {
        const imageNumber = imageIndex + 1;
        return [`Image ${imageNumber}`, `主图${imageNumber}`, `主图 ${imageNumber}`];
      }

      function imageIndexForExcelRow(rowNumber: number) {
        for (let current = rowNumber; current >= Math.max(1, rowNumber - 1); current -= 1) {
          const imageIndex = imageRowIndexByRowNumber.get(current);
          if (
            imageIndex !== undefined &&
            imageIndex >= 0 &&
            imageIndex < maxRows
          ) {
            return imageIndex;
          }
        }
        return null;
      }

      infoRows.forEach((row) => {
        nextCompetitors.forEach((competitor, index) => {
          const colNumber = competitorColumnNumbers[index] ?? index + 2;
          const value = readCell(row.label, colNumber);
          mergeGalleryCellStyle(
            nextCellStyles,
            galleryCellKey(row.label, `competitor-${index}`),
            readCellStyle(row.label, colNumber),
          );
          if (!value) return;
          if (row.label === "ASIN") competitor.asin = value.trim();
          if (row.label === "产品卖点") competitor.productFeatures = value;
          if (row.label === "销量") competitor.sales = value;
          if (row.label === "价格") competitor.price = value;
          if (row.label === "变体") competitor.variation = value;
          if (row.label === "星级") competitor.rating = value;
          if (row.label === "评论数") competitor.reviewCount = value;
          if (row.label === "标题") competitor.title = value;
          if (row.label.startsWith("5点")) {
            const bulletIndex = Number(row.label.replace("5点", "")) - 1;
            competitor.bullets = updateBulletLine(competitor.bullets, bulletIndex, value);
          }
        });
        const mineValue = mineColNumber ? readCell(row.label, mineColNumber) : "";
        if (mineColNumber) {
          mergeGalleryCellStyle(
            nextCellStyles,
            galleryCellKey(row.label, mineColumn.key),
            readCellStyle(row.label, mineColNumber),
          );
        }
        if (mineValue) {
          if (row.label === "ASIN") nextInput.asin = mineValue.trim();
          if (row.label === "产品卖点") nextInput.mainSellingPoint1 = mineValue;
          if (row.label === "销量") nextOwnImages.sales = mineValue;
          if (row.label === "价格") nextOwnImages.price = mineValue;
          if (row.label === "变体") nextInput.variationInfo = mineValue;
          if (row.label === "星级") nextOwnImages.rating = mineValue;
          if (row.label === "评论数") nextOwnImages.reviewCount = mineValue;
          if (row.label === "标题") nextInput.currentTitle = mineValue;
          if (row.label.startsWith("5点")) {
            const bulletIndex = Number(row.label.replace("5点", "")) - 1;
            nextInput.currentBullets = updateBulletLine(
              nextInput.currentBullets,
              bulletIndex,
              mineValue,
            );
          }
        }
      });

      const aplusMineValue = mineColNumber ? readCell("A+", mineColNumber) : "";
      if (aplusMineValue) nextInput.aplusRequirements = aplusMineValue;
      nextCompetitors.forEach((competitor, index) => {
        const colNumber = competitorColumnNumbers[index] ?? index + 2;
        const value = readCell("A+", colNumber);
        mergeGalleryCellStyle(
          nextCellStyles,
          galleryCellKey(aplusRow.label, `competitor-${index}`),
          readCellStyle("A+", colNumber),
        );
        if (value) competitor.aplus = value;
      });
      if (mineColNumber) {
        mergeGalleryCellStyle(
          nextCellStyles,
          galleryCellKey(aplusRow.label, mineColumn.key),
          readCellStyle("A+", mineColNumber),
        );
      }

      for (let imageIndex = 0; imageIndex < maxRows; imageIndex += 1) {
        const rowNumber = rowNumberForLabels(imageLabels(imageIndex));
        if (!rowNumber) continue;
        const labelCell = excelCellToText(worksheet.getCell(rowNumber, 1).value);
        nextOwnImages.imageNotes[imageIndex] = labelCell.split("\n").slice(1).join("\n");
      }

      const mediaItems =
        ((workbook.model as unknown) as {
          media?: Array<{
            index?: number;
            buffer?: Uint8Array | ArrayBuffer;
            extension?: string;
          }>;
        }).media ?? [];
      const mediaById = new Map(
        mediaItems
          .filter((media): media is typeof media & { index: number } =>
            typeof media.index === "number",
          )
          .map((media) => [media.index, media]),
      );
      const worksheetImages = worksheet.getImages();
      for (const image of worksheetImages) {
        const excelRowNumber = image.range.tl.nativeRow + 1;
        const excelColNumber = image.range.tl.nativeCol + 1;
        const imageIndex = imageIndexForExcelRow(excelRowNumber);
        if (imageIndex === null || excelColNumber < 1) continue;
        const media = mediaById.get(Number(image.imageId));
        if (!media?.buffer) continue;
        const extension = media.extension || "png";
        const sourceBytes =
          media.buffer instanceof ArrayBuffer
            ? new Uint8Array(media.buffer)
            : new Uint8Array(
                media.buffer.buffer,
                media.buffer.byteOffset,
                media.buffer.byteLength,
              );
        const buffer = sourceBytes.slice().buffer;
        const blob = new Blob([buffer], {
          type: `image/${extension === "jpg" ? "jpeg" : extension}`,
        });
        const name = `imported-image-${imageIndex + 1}-${excelColNumber}.${extension}`;
        const asset = await saveListingAiImageAsset(
          new File([blob], name, { type: blob.type }),
        );
        const preview = {
          name,
          url: await blobToDataUrl(asset.blob),
          assetId: asset.id,
        };
        const competitorIndex = competitorColumnNumbers.indexOf(excelColNumber);
        if (mineColNumber && excelColNumber === mineColNumber) {
          nextOwnImages.images[imageIndex] = preview;
        } else if (competitorIndex >= 0) {
          nextCompetitors[competitorIndex].images[imageIndex] = preview;
        }
      }

      setCompetitors(nextCompetitors);
      setOwnImages(nextOwnImages);
      setCellStyles(nextCellStyles);
      (Object.keys(nextInput) as Array<keyof ListingOptimizationRequest>).forEach((key) =>
        update(key, nextInput[key]),
      );
      if (!worksheetImages.length) {
        setExcelNotice("已导入文字信息；这个 Excel 文件里没有可读取的嵌入图片。");
      }
    } catch (importError) {
      setExcelError(importError instanceof Error ? importError.message : "Excel 导入失败。");
    } finally {
      setExcelBusy(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Competitor Images Gallery</CardTitle>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(event) =>
                void handleImportGalleryExcel(event.target.files?.[0] ?? null)
              }
            />
            {excelError ? (
              <span className="max-w-md truncate text-xs font-semibold text-red-600">
                {excelError}
              </span>
            ) : null}
            {excelNotice ? (
              <span className="max-w-md truncate text-xs font-semibold text-muted">
                {excelNotice}
              </span>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={!focusedCellKey}
              onClick={markSelectedTextRed}
              title="当前单元格文字标红"
            >
              <span className="text-base font-black leading-none text-red-700">A</span>
              红字
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!focusedCellKey}
              onClick={() => toggleFocusedCellStyle("yellowBg")}
              title="当前单元格背景标黄"
            >
              <Highlighter className="h-4 w-4 text-yellow-600" />
              黄底
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={addCompetitorColumn}
              title="Add competitor"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              disabled={competitors.length <= 1}
              onClick={removeCompetitorColumn}
              title="Remove competitor"
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={excelBusy}
              onClick={() => importInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              导入 Excel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={excelBusy}
              onClick={() => void handleExportGalleryExcel()}
            >
              {excelBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              导出 Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[1030px] overflow-auto thin-scrollbar">
          <table
            className="min-w-full table-fixed text-left text-sm"
            style={{ width: tableWidth }}
          >
            <thead className="sticky top-0 z-10 bg-surface-muted text-xs font-bold text-muted">
              <tr>
                <th className="sticky left-0 z-20 w-36 bg-surface-muted px-4 py-3">
                  Image
                </th>
                {competitorColumns.map((column) => (
                  <th key={column.key} className="w-[260px] px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span>{column.label}</span>
                      <MiniUploader
                        images={column.images}
                        label="Upload"
                        onUpload={(files) =>
                          handleImageUpload(files, (images) =>
                            setColumnImages(column.type, column.index, images),
                          )
                        }
                      />
                    </div>
                  </th>
                ))}
                <th className="w-[260px] px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span>{mineColumn.label}</span>
                    <MiniUploader
                      images={mineColumn.images}
                      label="Upload"
                      onUpload={(files) =>
                        handleImageUpload(files, (images) =>
                          setColumnImages(mineColumn.type, mineColumn.index, images),
                        )
                      }
                    />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Array.from({ length: maxRows }).map((_, index) => (
                <tr key={index}>
                  <td className="sticky left-0 z-[1] bg-white px-3 py-3 align-middle">
                    <label className="block text-sm font-black text-foreground">
                      Image {index + 1}
                    </label>
                    <textarea
                      className="mt-2 h-[200px] w-full resize-none rounded-md border border-border bg-white px-2 py-1.5 text-xs font-medium leading-5 text-foreground outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/10"
                      value={ownImages.imageNotes?.[index] ?? ""}
                      onChange={(event) =>
                        updateImageNote(index, event.target.value)
                      }
                      placeholder="备注"
                    />
                  </td>
                  {competitorColumns.map((column) => (
                    <td key={column.key} className="px-4 py-3 align-top">
                      <GalleryCell
                        image={column.images[index]}
                        draggable={Boolean(column.images[index])}
                        onDragStart={() =>
                          setDraggedImage({
                            column: column.type,
                            columnIndex: column.index,
                            imageIndex: index,
                          })
                        }
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() =>
                          handleDrop(column.type, column.index, index)
                        }
                        onMoveUp={() =>
                          moveImage(column.type, column.index, index, index - 1)
                        }
                        onMoveDown={() =>
                          moveImage(column.type, column.index, index, index + 1)
                        }
                        canMoveUp={index > 0}
                        canMoveDown={index < column.images.length - 1}
                        onPreview={() => setPreviewImage(column.images[index])}
                      />
                    </td>
                  ))}
                  <td className="px-4 py-3 align-top">
                    <GalleryCell
                      image={mineColumn.images[index]}
                      mine
                      draggable={Boolean(mineColumn.images[index])}
                      onDragStart={() =>
                        setDraggedImage({
                          column: mineColumn.type,
                          columnIndex: mineColumn.index,
                          imageIndex: index,
                        })
                      }
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() =>
                        handleDrop(mineColumn.type, mineColumn.index, index)
                      }
                      onMoveUp={() =>
                        moveImage(mineColumn.type, mineColumn.index, index, index - 1)
                      }
                      onMoveDown={() =>
                        moveImage(mineColumn.type, mineColumn.index, index, index + 1)
                      }
                      canMoveUp={index > 0}
                      canMoveDown={index < mineColumn.images.length - 1}
                      onPreview={() => setPreviewImage(mineColumn.images[index])}
                    />
                  </td>
                </tr>
              ))}
              {infoRows.map((row) => (
                <tr key={row.label}>
                  <td className="sticky left-0 z-[1] bg-white px-3 py-3 align-middle text-sm font-black text-foreground">
                    {row.label}
                  </td>
                  {competitorColumns.map((column) => {
                    const competitor = competitors[column.index];
                    const value = competitor ? row.competitorValue(competitor) : "";
                    const styleKey = galleryCellKey(row.label, column.key);
                    return (
                      <td key={column.key} className="px-4 py-3 align-top">
                        {row.asin
                          ? renderAsinCell(value, (nextValue) =>
                              row.updateCompetitor(column.index, nextValue),
                              styleKey,
                            )
                          : renderTextCell(
                              value,
                              (nextValue) =>
                                row.updateCompetitor(column.index, nextValue),
                              row.multiline,
                              row.tall,
                              styleKey,
                            )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 align-top">
                    {row.asin
                      ? renderAsinCell(
                          row.mineValue,
                          row.updateMine,
                          galleryCellKey(row.label, mineColumn.key),
                        )
                      : renderTextCell(
                          row.mineValue,
                          row.updateMine,
                          row.multiline,
                          row.tall,
                          galleryCellKey(row.label, mineColumn.key),
                        )}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="sticky left-0 z-[1] bg-white px-3 py-3 align-middle text-sm font-black text-foreground">
                  {aplusRow.label}
                </td>
                {competitorColumns.map((column) => {
                  const competitor = competitors[column.index];
                  const styleKey = galleryCellKey(aplusRow.label, column.key);
                  return (
                    <td key={column.key} className="px-4 py-3 align-top">
                      {renderTextCell(
                        competitor ? aplusRow.competitorValue(competitor) : "",
                        (value) => aplusRow.updateCompetitor(column.index, value),
                        aplusRow.multiline,
                        false,
                        styleKey,
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-3 align-top">
                  {renderTextCell(
                    aplusRow.mineValue,
                    aplusRow.updateMine,
                    aplusRow.multiline,
                    false,
                    galleryCellKey(aplusRow.label, mineColumn.key),
                  )}
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Image Assets Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            className={`${fieldClass} min-h-32 resize-y`}
            value={ownImages.structureNotes}
            onChange={(event) =>
              setOwnImages((current) => ({
                ...current,
                structureNotes: event.target.value,
              }))
            }
            placeholder="记录自身图片结构、差距、希望 AI 策划强化的方向"
          />
        </CardContent>
      </Card>
      {previewImage ? (
        <ImagePreviewModal
          image={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      ) : null}
    </div>
  );
}

function VisualAplusSection({
  competitors,
  ownImages,
  setCompetitors,
  setOwnImages,
  input,
  update,
  error,
  canSubmit,
  loading,
  onGenerate,
  result,
  handleImageUpload,
}: {
  competitors: CompetitorDraft[];
  ownImages: OwnImageDraft;
  setCompetitors: React.Dispatch<React.SetStateAction<CompetitorDraft[]>>;
  setOwnImages: React.Dispatch<React.SetStateAction<OwnImageDraft>>;
  input: ListingOptimizationRequest;
  update: <K extends keyof ListingOptimizationRequest>(
    key: K,
    value: ListingOptimizationRequest[K],
  ) => void;
  error: string;
  canSubmit: boolean;
  loading: boolean;
  onGenerate: () => void;
  result: ListingOptimizationResult | null;
  handleImageUpload: (
    files: FileList | null,
    callback: (images: ImagePreview[]) => void,
  ) => void;
}) {
  return (
    <div className="space-y-4">
      <ImagesSection
        competitors={competitors}
        ownImages={ownImages}
        setCompetitors={setCompetitors}
        setOwnImages={setOwnImages}
        input={input}
        update={update}
        handleImageUpload={handleImageUpload}
      />
      <ListingAiAplusPanel
        result={result}
        input={input}
        update={update}
        error={error}
        canSubmit={canSubmit}
        loading={loading}
        onGenerate={onGenerate}
      />
    </div>
  );
}

function CompetitorColumn({
  label,
  asin,
  mainImage,
  title,
  bullets,
  targetAudience,
  useScenarios,
  productFeatures,
  opportunity,
  screenshot,
  images,
  onAsinChange,
  onMainImageUpload,
  onTitleChange,
  onBulletsChange,
  onTargetAudienceChange,
  onUseScenariosChange,
  onProductFeaturesChange,
  onOpportunityChange,
  onScreenshotUpload,
  onImagesUpload,
}: {
  label: string;
  asin: string;
  mainImage: ImagePreview[];
  title: string;
  bullets: string;
  targetAudience: string;
  useScenarios: string;
  productFeatures: string;
  opportunity: string;
  screenshot: ImagePreview[];
  images: ImagePreview[];
  onAsinChange: (value: string) => void;
  onMainImageUpload: (files: FileList | null) => void;
  onTitleChange: (value: string) => void;
  onBulletsChange: (value: string) => void;
  onTargetAudienceChange: (value: string) => void;
  onUseScenariosChange: (value: string) => void;
  onProductFeaturesChange: (value: string) => void;
  onOpportunityChange: (value: string) => void;
  onScreenshotUpload: (files: FileList | null) => void;
  onImagesUpload: (files: FileList | null) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-white">
      <div className="border-b border-border bg-surface-muted px-4 py-3">
        <p className="text-base font-black text-foreground">{label}</p>
      </div>
      <div className="grid grid-rows-[160px_160px_300px_128px_128px_160px_160px_192px_160px_272px] gap-4 p-4">
        <ImageStrip
          title="主图"
          images={mainImage}
          onUpload={onMainImageUpload}
          variant="main"
        />
        <InfoField label="标题" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-24 resize-none`}
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </InfoField>
        <InfoField label="五点描述" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-52 resize-none`}
            value={bullets}
            onChange={(event) => onBulletsChange(event.target.value)}
          />
        </InfoField>
        <InfoField label="ASIN" className="overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_44px] gap-2">
            <input
              className={fieldClass}
              value={asin}
              onChange={(event) => onAsinChange(event.target.value.trim())}
            />
            <AmazonLinkButton asin={asin} />
          </div>
        </InfoField>
        <InfoField label="目标人群" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-16 resize-none`}
            value={targetAudience}
            onChange={(event) => onTargetAudienceChange(event.target.value)}
          />
        </InfoField>
        <InfoField label="使用场景" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-16 resize-none`}
            value={useScenarios}
            onChange={(event) => onUseScenariosChange(event.target.value)}
          />
        </InfoField>
        <InfoField label="产品特点" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-24 resize-none`}
            value={productFeatures}
            onChange={(event) => onProductFeaturesChange(event.target.value)}
          />
        </InfoField>
        <InfoField label="卖点对比" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-24 resize-none`}
            value={opportunity}
            onChange={(event) => onOpportunityChange(event.target.value)}
          />
        </InfoField>
        <ImageStrip
          title="截图"
          images={screenshot}
          onUpload={onScreenshotUpload}
          variant="single"
        />
        <ImageStrip
          title="图片"
          images={images}
          onUpload={onImagesUpload}
          variant="gallery"
        />
      </div>
    </div>
  );
}

function MineColumn({
  input,
  ownImages,
  update,
  setOwnImages,
  onImagesUpload,
}: {
  input: ListingOptimizationRequest;
  ownImages: OwnImageDraft;
  update: <K extends keyof ListingOptimizationRequest>(
    key: K,
    value: ListingOptimizationRequest[K],
  ) => void;
  setOwnImages: React.Dispatch<React.SetStateAction<OwnImageDraft>>;
  onImagesUpload: (files: FileList | null) => void;
}) {
  const bulletLines = input.currentBullets
    .split(/\n+/)
    .filter((line) => line.trim());
  const bulletTotal = input.currentBullets.length;

  return (
    <div className="rounded-md border border-brand bg-brand/5">
      <div className="border-b border-brand/20 bg-brand px-4 py-3">
        <p className="text-base font-black text-white">Mine</p>
      </div>
      <div className="grid grid-rows-[160px_160px_300px_128px_128px_160px_160px_192px_160px_272px] gap-4 p-4">
        <InfoField label="图片 / 机会备注" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-24 resize-none`}
            value={ownImages.structureNotes}
            onChange={(event) =>
              setOwnImages((current) => ({
                ...current,
                structureNotes: event.target.value,
              }))
            }
            placeholder="我们要放大的差异点、图片结构、需要补拍的问题"
          />
        </InfoField>

        <InfoField label="标题" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-20 resize-none ${input.currentTitle.length > 200 ? "border-red-300 bg-red-50" : ""}`}
            value={input.currentTitle}
            onChange={(event) => update("currentTitle", event.target.value)}
            placeholder="标题通用上限 ≤200 字符；最强差异化卖点放在前 80 位"
          />
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-semibold">
            <span
              className={
                input.currentTitle.length <= 200
                  ? "text-green-700"
                  : "text-red-700"
              }
            >
              {input.currentTitle.length}/200 chars
            </span>
            <span
              className={
                input.currentTitle.slice(0, 80).trim()
                  ? "text-green-700"
                  : "text-amber-700"
              }
            >
              前 80 字符放核心卖点
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">
            移动端仅展示前 70-80 字符，最强差异化卖点必须前置。
          </p>
        </InfoField>

        <InfoField label="五点描述" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-52 resize-none ${bulletTotal > 1000 ? "border-red-300 bg-red-50" : ""}`}
            value={input.currentBullets}
            onChange={(event) => update("currentBullets", event.target.value)}
            placeholder={
              "每行一条，共 5 条；单条 10-255 字符，推荐 120-200 字符"
            }
          />
          <p
            className={`mt-2 text-xs font-bold ${bulletTotal <= 1000 ? "text-green-700" : "text-red-700"}`}
          >
            已填写 {bulletLines.length}/5 条；合计 {bulletTotal}/1000
            字符，利于索引收录。
          </p>
        </InfoField>

        <InfoField label="ASIN" className="overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_44px] gap-2">
            <input
              className={fieldClass}
              value={input.asin}
              onChange={(event) => update("asin", event.target.value.trim())}
            />
            <AmazonLinkButton asin={input.asin} />
          </div>
        </InfoField>
        <InfoField label="目标人群" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-16 resize-none`}
            value={input.targetAudience}
            onChange={(event) => update("targetAudience", event.target.value)}
          />
        </InfoField>
        <InfoField label="使用场景" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-16 resize-none`}
            value={input.useScenarios}
            onChange={(event) => update("useScenarios", event.target.value)}
          />
        </InfoField>
        <InfoField label="产品特点" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-24 resize-none`}
            value={input.productFacts}
            onChange={(event) => update("productFacts", event.target.value)}
          />
        </InfoField>
        <InfoField label="主卖点" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-28 resize-none border-amber-300 bg-amber-50/40`}
            value={input.mainSellingPoint1}
            onChange={(event) =>
              update("mainSellingPoint1", event.target.value)
            }
            placeholder="主卖点"
          />
        </InfoField>
        <AlignedPlaceholder label="截图" />
        <ImageStrip
          title="图片"
          images={ownImages.images}
          onUpload={onImagesUpload}
          mine
          variant="gallery"
        />
      </div>
    </div>
  );
}

function WorkspaceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-32 flex-col justify-center p-4">
      <p className="text-xs font-bold uppercase tracking-normal text-muted">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black text-foreground">{value}</p>
    </div>
  );
}
