import type { AgentContext, JsonObject, JsonValue } from "./types";
import type { MarketExecutionRequest, MarketResearchInput, MarketRange } from "./market-contracts";

export function normalizeMarketExecutionInput(request: MarketExecutionRequest, context: AgentContext): MarketResearchInput {
  const naturalLanguageGoal = cleanText(request.naturalLanguageGoal) || cleanText(request.keyword) || cleanText(request.category) || "Find Amazon market opportunities";
  const marketplace = cleanText(request.marketplace) || cleanText(context.marketplace) || "US";
  const keyword = cleanText(request.keyword) || inferKeywordFromGoal(naturalLanguageGoal);
  const category = cleanText(request.category) || inferCategoryFromContext(context) || inferCategoryFromGoal(naturalLanguageGoal);
  const asin = cleanText(request.asin) || cleanText(context.asin);

  return {
    naturalLanguageGoal,
    marketplace,
    keyword,
    category,
    asin,
    priceRange: normalizeRange(request.priceRange),
    salesRange: normalizeRange(request.salesRange),
    reviewRange: normalizeRange(request.reviewRange),
    competition: cleanText(request.competition),
    targetMargin: typeof request.targetMargin === "number" && Number.isFinite(request.targetMargin) ? request.targetMargin : undefined,
    productConstraints: normalizeConstraintList(request.productConstraints),
    currentSkuContext: toJsonValue(context.currentData ?? context.product ?? null),
  };
}

export function extractJsonObject(value: JsonValue | undefined): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JsonObject;
}

export function normalizeRange(value?: MarketRange) {
  if (!value) return undefined;

  const min = typeof value.min === "number" && Number.isFinite(value.min) ? value.min : undefined;
  const max = typeof value.max === "number" && Number.isFinite(value.max) ? value.max : undefined;

  if (min === undefined && max === undefined) return undefined;

  return { min, max };
}

export function normalizeConstraintList(value?: string[] | string) {
  if (Array.isArray(value)) {
    return value.map(cleanText).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map(cleanText)
      .filter(Boolean);
  }

  return [];
}

export function inferKeywordFromGoal(goal: string) {
  const keywordMatch = goal.match(/(?:keyword|关键词|搜词|search)\s*[:：]?\s*([A-Za-z0-9\s-]+)/i);
  return cleanText(keywordMatch?.[1]) || undefined;
}

export function inferCategoryFromGoal(goal: string) {
  const categoryMatch = goal.match(/(?:category|类目)\s*[:：]?\s*([A-Za-z0-9&\s-]+)/i);
  return cleanText(categoryMatch?.[1]) || undefined;
}

export function inferCategoryFromContext(context: AgentContext) {
  const product = context.product as Record<string, unknown> | undefined;
  const currentData = context.currentData as Record<string, unknown> | undefined;
  return cleanText(String(product?.category ?? currentData?.category ?? "")) || undefined;
}

export function cleanText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "";
}

export function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampScore(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return clampScore(parsed);
  }

  return clampScore(fallback);
}

export function averageNumbers(values: number[]) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) return 0;

  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

export function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function clampDecimal(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function hashText(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

export function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, toJsonValue(item)]),
    );
  }

  return null;
}
