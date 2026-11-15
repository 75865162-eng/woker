import {
  emptyStudioInput,
  type StudioImage,
  type StudioImageIdea,
  type StudioProductInput,
  type StudioResult,
} from "@/lib/listing-ai/studio";

export const studioDraftStorageKey = "listing-ai-studio-draft-v1";
export const studioHistoryStorageKey = "listing-ai-studio-history-v1";
export const studioHistoryLimit = 20;

export interface StudioHistoryEntry {
  id: string;
  createdAt: string;
  label: string;
  marketplace: string;
  model: string;
  input: StudioProductInput;
  result: StudioResult;
  imageIdeas: StudioImageIdea[];
  competitorImages: StudioImage[];
  ownImages: StudioImage[];
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isStudioResult(value: unknown): value is StudioResult {
  if (!value || typeof value !== "object") return false;

  const result = value as Partial<StudioResult>;

  return Array.isArray(result.titles) && Array.isArray(result.bullets);
}

function normalizeEntry(value: unknown): StudioHistoryEntry | null {
  if (!value || typeof value !== "object") return null;

  const entry = value as Partial<StudioHistoryEntry>;

  if (typeof entry.id !== "string" || !isStudioResult(entry.result)) return null;

  return {
    id: entry.id,
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
    label: typeof entry.label === "string" ? entry.label : "未命名商品",
    marketplace: typeof entry.marketplace === "string" ? entry.marketplace : "US",
    model: typeof entry.model === "string" ? entry.model : "",
    input: { ...emptyStudioInput, ...(entry.input as StudioProductInput | undefined) },
    result: entry.result,
    imageIdeas: Array.isArray(entry.imageIdeas) ? entry.imageIdeas : [],
    competitorImages: Array.isArray(entry.competitorImages) ? entry.competitorImages : [],
    ownImages: Array.isArray(entry.ownImages) ? entry.ownImages : [],
  };
}

export function readStudioHistory(): StudioHistoryEntry[] {
  if (!canUseStorage()) return [];

  try {
    const raw = window.localStorage.getItem(studioHistoryStorageKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => normalizeEntry(item))
      .filter((item): item is StudioHistoryEntry => Boolean(item))
      .slice(0, studioHistoryLimit);
  } catch {
    return [];
  }
}

export function writeStudioHistory(entries: StudioHistoryEntry[]) {
  if (!canUseStorage()) return false;

  for (const size of [studioHistoryLimit, 5, 1]) {
    try {
      window.localStorage.setItem(
        studioHistoryStorageKey,
        JSON.stringify(entries.slice(0, size)),
      );
      return true;
    } catch {
      // 配额不足时逐步裁剪历史条数后再试。
    }
  }

  return false;
}

export function createStudioHistoryEntry(params: {
  input: StudioProductInput;
  result: StudioResult;
  imageIdeas: StudioImageIdea[];
  competitorImages: StudioImage[];
  ownImages: StudioImage[];
  model: string;
}): StudioHistoryEntry {
  const label =
    params.input.chineseName.trim() ||
    params.input.englishName.trim() ||
    params.input.asin.trim() ||
    "未命名商品";

  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    label,
    marketplace: params.input.marketplace,
    model: params.model,
    input: params.input,
    result: params.result,
    imageIdeas: params.imageIdeas,
    competitorImages: params.competitorImages,
    ownImages: params.ownImages,
  };
}

export function pushStudioHistory(entry: StudioHistoryEntry, list: StudioHistoryEntry[]) {
  return [entry, ...list.filter((item) => item.id !== entry.id)].slice(0, studioHistoryLimit);
}

export function removeStudioHistoryEntry(list: StudioHistoryEntry[], id: string) {
  return list.filter((item) => item.id !== id);
}

export function readStudioDraft(): StudioProductInput {
  if (!canUseStorage()) return emptyStudioInput;

  try {
    const raw = window.localStorage.getItem(studioDraftStorageKey);
    if (!raw) return emptyStudioInput;

    return { ...emptyStudioInput, ...(JSON.parse(raw) as Partial<StudioProductInput>) };
  } catch {
    return emptyStudioInput;
  }
}

export function writeStudioDraft(input: StudioProductInput) {
  if (!canUseStorage()) return;

  try {
    window.localStorage.setItem(studioDraftStorageKey, JSON.stringify(input));
  } catch {
    // 存储写满或被禁用时静默失败，页面仍可正常使用。
  }
}

export function clearStudioDraft() {
  if (!canUseStorage()) return;

  try {
    window.localStorage.removeItem(studioDraftStorageKey);
  } catch {
    // 忽略。
  }
}

export function formatHistoryTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
