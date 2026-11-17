"use client";

import { createBrowserId } from "@/lib/browser/random-id";
import { blobToDataUrl, readListingAiImageAsset } from "@/lib/listing-ai/image-assets";
import { initialDescriptionGenerator, imageGeneratorViews, initialImageGenerator, initialTitleGenerator, type CompetitorDraft, type DescriptionGeneratorDraft, type DescriptionGeneratorField, type DescriptionGeneratorHistoryRecord, type ImageGeneratorDraft, type ImagePreview, type OwnImageDraft, type SavedRecord, type TitleGeneratorDraft, type TitleGeneratorField, type TitleGeneratorMode, type TitleGeneratorModeDraft, type WorkspaceDraft } from "@/lib/listing-ai/workspace-draft";
import { type AiModelSettings } from "@/lib/ai-settings";

export async function hydrateImage(image: ImagePreview): Promise<ImagePreview> {
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

export async function hydrateImages(images: ImagePreview[] | undefined) {
  const hydratedImages = await Promise.all(
    (Array.isArray(images) ? images : []).map(hydrateImage),
  );

  return hydratedImages.filter((image) => image.url);
}

export function compactImageForRequest(image: ImagePreview): ImagePreview {
  if (image.assetId) {
    return {
      name: image.name,
      url: "",
      assetId: image.assetId,
    };
  }

  return image;
}

export async function hydrateCompetitorDraft(competitor: CompetitorDraft) {
  return {
    ...competitor,
    mainImage: await hydrateImages(competitor.mainImage),
    screenshot: await hydrateImages(competitor.screenshot),
    images: await hydrateImages(competitor.images),
  };
}

export async function hydrateOwnImageDraft(ownImages: OwnImageDraft) {
  return {
    ...ownImages,
    mainImage: await hydrateImages(ownImages.mainImage),
    images: await hydrateImages(ownImages.images),
  };
}

export async function hydrateImageGeneratorDraft(draft: ImageGeneratorDraft) {
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
    history: await Promise.all(
      (Array.isArray(draft.history) ? draft.history : []).map(async (record) => ({
        ...record,
        images: await hydrateImages(record.images),
      })),
    ),
  };
}

export function stripCompetitorImages(competitor: CompetitorDraft): CompetitorDraft {
  return {
    ...competitor,
    mainImage: [],
    screenshot: [],
    images: [],
  };
}

export function stripOwnImageDraftImages(ownImages: OwnImageDraft): OwnImageDraft {
  return {
    ...ownImages,
    mainImage: [],
    images: [],
  };
}

export function stripImageGeneratorDraftImages(draft: ImageGeneratorDraft): ImageGeneratorDraft {
  return {
    ...draft,
    ownViews: imageGeneratorViews.reduce((acc, view) => {
      acc[view.key] = [];
      return acc;
    }, { ...initialImageGenerator.ownViews }),
    competitorImages: [],
    generatedImages: [],
    history: Array.isArray(draft.history)
      ? draft.history.map((record) => ({
          ...record,
          images: [],
        }))
      : [],
  };
}

export function readLocalAiSettings(storageKey: string) {
  try {
    const saved = window.localStorage.getItem(storageKey);

    if (!saved) return null;

    const parsed = JSON.parse(saved) as Partial<AiModelSettings>;
    return typeof parsed.apiKey === "string" && parsed.apiKey.trim()
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function mergeTitleGeneratorFields(fields: TitleGeneratorField[] | undefined) {
  return initialTitleGenerator.fields.map((field) => ({
    ...field,
    ...fields?.find((savedField) => savedField.key === field.key),
  }));
}

export function mergeDescriptionGeneratorFields(
  fields: DescriptionGeneratorField[] | undefined,
) {
  return initialDescriptionGenerator.fields.map((field) => ({
    ...field,
    ...fields?.find((savedField) => savedField.key === field.key),
  }));
}

export function normalizeTitleGeneratorModeDraft(
  draft: Partial<TitleGeneratorModeDraft> | undefined,
  legacyDraft?: Partial<TitleGeneratorDraft>,
): TitleGeneratorModeDraft {
  return {
    fields: mergeTitleGeneratorFields(draft?.fields ?? legacyDraft?.fields),
    results: Array.isArray(draft?.results)
      ? draft.results
      : Array.isArray(legacyDraft?.results)
        ? legacyDraft.results
        : [],
    history: Array.isArray(draft?.history)
      ? draft.history
      : Array.isArray(legacyDraft?.history)
        ? legacyDraft.history
        : [],
  };
}

export function normalizeTitleGeneratorDraft(
  draft: Partial<TitleGeneratorDraft>,
): TitleGeneratorDraft {
  const mode: TitleGeneratorMode = draft.mode === "new" ? "new" : "old";
  const oldDraft = normalizeTitleGeneratorModeDraft(
    draft.modes?.old,
    mode === "old" ? draft : undefined,
  );
  const newDraft = normalizeTitleGeneratorModeDraft(
    draft.modes?.new,
    mode === "new" ? draft : undefined,
  );
  const activeDraft = mode === "new" ? newDraft : oldDraft;

  return {
    ...initialTitleGenerator,
    ...draft,
    mode,
    prompt: draft.prompt?.trim() ? draft.prompt : initialTitleGenerator.prompt,
    fields: activeDraft.fields,
    results: activeDraft.results,
    history: activeDraft.history,
    modes: {
      old: oldDraft,
      new: newDraft,
    },
  };
}

export function normalizeDescriptionGeneratorDraft(
  draft: Partial<DescriptionGeneratorDraft>,
): DescriptionGeneratorDraft {
  return {
    ...initialDescriptionGenerator,
    ...draft,
    prompt:
      draft.prompt?.trim() ? draft.prompt : initialDescriptionGenerator.prompt,
    fields: mergeDescriptionGeneratorFields(draft.fields),
    results: Array.isArray(draft.results) ? draft.results : [],
    history: Array.isArray(draft.history)
      ? draft.history
          .filter((record): record is DescriptionGeneratorHistoryRecord =>
            Boolean(record && typeof record === "object"),
          )
          .map((record) => ({
            id: typeof record.id === "string" ? record.id : createBrowserId(),
            createdAt:
              typeof record.createdAt === "string"
                ? record.createdAt
                : new Date().toLocaleString("zh-CN", { hour12: false }),
            mode: record.mode === "new" ? "new" : "old",
            fields: mergeDescriptionGeneratorFields(record.fields),
            prompt:
              typeof record.prompt === "string"
                ? record.prompt
                : initialDescriptionGenerator.prompt,
            results: Array.isArray(record.results)
              ? record.results.filter(
                  (item): item is string => typeof item === "string",
                )
              : [],
          }))
      : [],
  };
}

export interface ListingAiGenerationResponse {
  results?: string[];
  error?: string;
}

export async function readListingAiGenerationResponse(
  response: Response,
): Promise<ListingAiGenerationResponse> {
  const raw = await response.text();

  if (!raw.trim()) {
    return {
      error: `接口没有返回内容（HTTP ${response.status}）。请检查服务端日志和 AI 配置。`,
    };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (parsed && typeof parsed === "object") {
      const payload = parsed as Record<string, unknown>;
      return {
        results: Array.isArray(payload.results)
          ? payload.results.filter((item): item is string => typeof item === "string")
          : undefined,
        error: typeof payload.error === "string" ? payload.error : undefined,
      };
    }
  } catch {
    // Some proxy/server failures return HTML or plain text instead of JSON.
  }

  const plainText = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return {
    error: `接口返回了无法识别的内容（HTTP ${response.status}）：${plainText.slice(0, 300)}`,
  };
}

export async function saveListingAiWorkspace(draft: WorkspaceDraft, records: SavedRecord[]) {
  const response = await fetch("/api/listing-ai/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      draft,
      records,
    }),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Listing AI 工作区保存失败。");
  }
}
