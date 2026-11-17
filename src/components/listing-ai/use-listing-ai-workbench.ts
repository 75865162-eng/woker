"use client";

import { useMemo, useState } from "react";
import { createBrowserId } from "@/lib/browser/random-id";
import { blobToDataUrl, saveListingAiImageAsset } from "@/lib/listing-ai/image-assets";
import type { ListingOptimizationApiRequest, ListingOptimizationRequest, ListingOptimizationResult } from "@/lib/listing-ai/types";
import { buildCompetitorInfo, buildImageRequirements, imageGeneratorViews, initialCompetitors, initialImageGenerator, initialInput, type CompetitorDraft, type GalleryCellStyle, type ImageGeneratorDraft, type ImagePreview, type OwnImageDraft, type SavedRecord, type TabId } from "@/lib/listing-ai/workspace-draft";
import { aiImageSettingsStorageKey, aiSettingsStorageKey, normalizeAiSettings } from "@/lib/ai-settings";
import { compactImageForRequest, readLocalAiSettings } from "./listing-ai-workspace-runtime";
import { useListingAiTextGeneration } from "./use-listing-ai-text-generation";
import { useListingAiWorkspacePersistence } from "./use-listing-ai-workspace-persistence";
export function useListingAiWorkbench(requestedTab: TabId | null, canGenerateListing: boolean) {
  const { titleGenerator, setTitleGenerator, descriptionGenerator, setDescriptionGenerator, titlePromptOpen, setTitlePromptOpen, descriptionPromptOpen, setDescriptionPromptOpen, titleGenerating, descriptionGenerating, titleGeneratorError, descriptionGeneratorError, activeTitleGenerator, descriptionSharedFields, updateTitleGeneratorField, updateTitleGeneratorMode, updateDescriptionGeneratorField, loadTitleGeneratorHistory, loadDescriptionGeneratorHistory, handleGenerateTitles, handleGenerateDescriptions } = useListingAiTextGeneration();

  const [activeTab, setActiveTab] = useState<TabId>(requestedTab ?? "input");
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
  const [imageGenerator, setImageGenerator] = useState<ImageGeneratorDraft>(
    initialImageGenerator,
  );
  const [cellStyles, setCellStyles] = useState<Record<string, GalleryCellStyle>>({});
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageGeneratorError, setImageGeneratorError] = useState("");
  const [result, setResult] = useState<ListingOptimizationResult | null>(null);
  const [records, setRecords] = useState<SavedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const productName =
    input.asin ||
    input.productEnglishName ||
    input.productChineseName ||
    "Untitled Product";
  const canSubmit = canGenerateListing && !loading;
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

  async function handleOptimize() {
    setLoading(true);
    setError("");
    const aiSettings = readLocalAiSettings(aiSettingsStorageKey);

    const titleAsin =
      activeTitleGenerator.fields
        .find((field) => field.key === "asin")
        ?.value.trim() ?? "";
    const titleChineseName =
      activeTitleGenerator.fields
        .find((field) => field.key === "productChineseName")
        ?.value.trim() ?? "";
    const titleProductFacts =
      activeTitleGenerator.fields
        .find((field) => field.key === "productFeatures")
        ?.value.trim() ?? "";

    const payload: ListingOptimizationRequest = {
      ...input,
      asin: input.asin.trim() || titleAsin,
      productChineseName: input.productChineseName.trim() || titleChineseName,
      productFacts: input.productFacts.trim() || titleProductFacts,
      productType: input.productType || input.productEnglishName || titleAsin,
      competitorInfo,
      imageRequirements,
    };

    try {
      const response = await fetch("/api/listing-ai/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          aiSettings: aiSettings ? normalizeAiSettings(aiSettings) : undefined,
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
      id: createBrowserId(),
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
  }

  function loadRecord(record: SavedRecord) {
    setInput(record.input);
    setResult(record.result);
    setActiveTab("analysis");
    setError("");
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

    setImageGenerating(true);
    setImageGeneratorError("");

    try {
      const aiSettings = readLocalAiSettings(aiImageSettingsStorageKey);
      const response = await fetch("/api/listing-ai/generate-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: imageGenerator.prompt,
          ownViews: imageGeneratorViews.reduce(
            (views, view) => ({
              ...views,
              [view.key]: imageGenerator.ownViews[view.key].map(
                compactImageForRequest,
              ),
            }),
            {} as ImageGeneratorDraft["ownViews"],
          ),
          competitorImages: imageGenerator.competitorImages.map(
            compactImageForRequest,
          ),
          aiSettings: aiSettings ?? undefined,
        }),
      });
      const data = (await response.json()) as {
        images?: ImagePreview[];
        error?: string;
      };

      if (!response.ok || !data.images?.length) {
        throw new Error(data.error || "图片生成失败，请检查模型是否支持图片生成。");
      }

      const createdAt = new Date().toLocaleString("zh-CN", { hour12: false });
      setImageGenerator((current) => ({
        ...current,
        generatedImages: [...data.images!, ...current.generatedImages].slice(
          0,
          12,
        ),
        history: [
          {
            id: createBrowserId(),
            createdAt,
            prompt: current.prompt,
            ownViewCount: viewCount,
            competitorImageCount: current.competitorImages.length,
            images: data.images!,
          },
          ...current.history,
        ].slice(0, 30),
        lastRunAt: createdAt,
      }));
    } catch (error) {
      setImageGeneratorError(
        error instanceof Error ? error.message : "图片生成失败，请稍后重试。",
      );
    } finally {
      setImageGenerating(false);
    }
  }
  useListingAiWorkspacePersistence({ requestedTab, activeTab, setActiveTab, input, setInput, competitors, setCompetitors, ownImages, setOwnImages, titleGenerator, setTitleGenerator, descriptionGenerator, setDescriptionGenerator, imageGenerator, setImageGenerator, cellStyles, setCellStyles, records, setRecords });

  return { activeTab, setActiveTab, titleGenerator, activeTitleGenerator, descriptionGenerator, descriptionSharedFields, titleGenerating, descriptionGenerating, titleGeneratorError, descriptionGeneratorError, titlePromptOpen, descriptionPromptOpen, updateTitleGeneratorMode, updateTitleGeneratorField, updateDescriptionGeneratorField, setTitleGenerator, setDescriptionGenerator, setTitlePromptOpen, setDescriptionPromptOpen, handleGenerateTitles, handleGenerateDescriptions, loadTitleGeneratorHistory, loadDescriptionGeneratorHistory, competitors, ownImages, setCompetitors, setOwnImages, cellStyles, setCellStyles, input, update, error, canSubmit, loading, handleOptimize, result, handleImageUpload, copied, copyText, imageGenerator, imageGenerating, imageGeneratorError, setImageGenerator, handleRunImageGenerator, records, loadRecord };
}
