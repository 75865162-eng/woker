import type { JsonObject, JsonValue } from "./types";
import type { ProductDevelopmentReport, ProductEvidenceItem, ProductHandoffPayload } from "./product";
import type { MarketResearchReport, ProductOpportunity } from "./market";
import type { ListingExecutionRequest, ListingKeywordMap, ListingKeywordGroup, ListingTitleDraft, ListingBulletDraft, ListingDescriptionDraft, ListingAplusBrief, ListingDraft } from "./listing-contracts";

export function normalizeListingExecutionInput(request: ListingExecutionRequest, context: Record<string, unknown>) {
  const currentData = isRecord(context.currentData) ? context.currentData : {};
  const productHandoff = extractJsonObject(toJsonValue(request.productHandoff ?? currentData.productHandoff));
  const productReport = extractJsonObject(toJsonValue(request.productReport ?? currentData.productReport));
  const marketReport = extractJsonObject(toJsonValue(request.marketReport ?? currentData.marketReport));
  const productOpportunity = extractOpportunity(request.productOpportunity ?? currentData.productOpportunity);

  return {
    naturalLanguageGoal: String(request.naturalLanguageGoal ?? currentData.goal ?? productReport.summary ?? "Turn the product plan into a listing draft."),
    marketplace: String(request.marketplace ?? productReport.marketplace ?? marketReport.marketplace ?? productHandoff.marketplace ?? currentData.marketplace ?? context.marketplace ?? "US"),
    category: String(request.category ?? productReport.category ?? marketReport.category ?? productHandoff.category ?? currentData.category ?? "general"),
    productReport,
    supplierReport: request.supplierReport ?? currentData.supplierReport ?? null,
    marketReport,
    productOpportunity,
    productHandoff: Object.keys(productHandoff).length ? (productHandoff as unknown as ProductHandoffPayload) : null,
    sellerSpriteKeywords: request.sellerSpriteKeywords ?? currentData.sellerSpriteKeywords ?? null,
    competitors: request.competitors ?? currentData.competitors ?? null,
    currentSkuContext: request.currentSkuContext ?? currentData ?? null,
  };
}

export function summarizeProduct(
  report: ProductDevelopmentReport | JsonObject | null,
  marketReport: MarketResearchReport | JsonObject | null,
  productOpportunity: ProductOpportunity | JsonObject | null,
) {
  if (isRecord(report) && typeof report.summary === "string") return report.summary;
  if (isRecord(productOpportunity) && typeof productOpportunity.productIdea === "string") return productOpportunity.productIdea;
  if (isRecord(marketReport) && typeof marketReport.summary === "string") return marketReport.summary;
  return "No product context supplied.";
}

export function readSummary(value: unknown) {
  return isRecord(value) && typeof value.summary === "string" ? value.summary : null;
}

export function extractKeywordMap(value: JsonValue | undefined): ListingKeywordMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      primaryKeywords: [],
      secondaryKeywords: [],
      longTailKeywords: [],
      backendSearchTerms: [],
      competitorGaps: [],
      groups: [],
      notes: "Keyword map unavailable.",
    };
  }

  const record = value as Record<string, unknown>;
  const groups = Array.isArray(record.groups)
    ? record.groups.map((item) => {
        const group = isRecord(item) ? item : {};
        return {
          placement: normalizePlacement(group.placement),
          keywords: normalizeStringArray(group.keywords),
          intent: String(group.intent ?? "Intent"),
          rationale: String(group.rationale ?? "Rationale"),
        } satisfies ListingKeywordGroup;
      })
    : [];

  return {
    primaryKeywords: normalizeStringArray(record.primaryKeywords),
    secondaryKeywords: normalizeStringArray(record.secondaryKeywords),
    longTailKeywords: normalizeStringArray(record.longTailKeywords),
    backendSearchTerms: normalizeStringArray(record.backendSearchTerms),
    competitorGaps: normalizeStringArray(record.competitorGaps),
    groups,
    notes: String(record.notes ?? "Keyword map generated."),
  };
}

export function extractTitleDraft(value: JsonValue | undefined): ListingTitleDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      title: "Listing Title",
      characterCount: 0,
      primaryKeywords: [],
      secondaryKeywords: [],
      rationale: "No title draft available.",
    };
  }

  const record = value as Record<string, unknown>;
  const title = String(record.title ?? "Listing Title");

  return {
    title,
    characterCount: title.length,
    primaryKeywords: normalizeStringArray(record.primaryKeywords),
    secondaryKeywords: normalizeStringArray(record.secondaryKeywords),
    rationale: String(record.rationale ?? "Title draft generated."),
  };
}

export function extractBulletDrafts(value: JsonValue | undefined): ListingBulletDraft[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const bullets = Array.isArray(record.bulletDrafts) ? record.bulletDrafts : [];

  return bullets
    .map((item): ListingBulletDraft | null => {
      if (!isRecord(item)) return null;
      return {
        bullet: String(item.bullet ?? "Bullet"),
        keywordFocus: normalizeStringArray(item.keywordFocus),
        benefit: String(item.benefit ?? "Benefit"),
        evidenceNotes: normalizeStringArray(item.evidenceNotes),
      };
    })
    .filter((item): item is ListingBulletDraft => Boolean(item));
}

export function extractDescriptionDraft(value: JsonValue | undefined): ListingDescriptionDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      summary: "Description",
      paragraphs: [],
      keywordCoverage: [],
      complianceNotes: [],
    };
  }

  const record = value as Record<string, unknown>;

  return {
    summary: String(record.summary ?? "Description"),
    paragraphs: normalizeStringArray(record.paragraphs),
    keywordCoverage: normalizeStringArray(record.keywordCoverage),
    complianceNotes: normalizeStringArray(record.complianceNotes),
  };
}

export function extractAplusBrief(value: JsonValue | undefined): ListingAplusBrief {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      objective: "A+ brief",
      modules: [],
      imageStoryline: [],
      recommendations: [],
    };
  }

  const record = value as Record<string, unknown>;
  const modules = Array.isArray(record.modules)
    ? record.modules.map((item) => {
        const moduleRecord = isRecord(item) ? item : {};
        return {
          moduleName: String(moduleRecord.moduleName ?? "Module"),
          message: String(moduleRecord.message ?? "Message"),
          layout: String(moduleRecord.layout ?? "Layout"),
          visualNotes: normalizeStringArray(moduleRecord.visualNotes),
        };
      })
    : [];

  return {
    objective: String(record.objective ?? "A+ brief"),
    modules,
    imageStoryline: normalizeStringArray(record.imageStoryline),
    recommendations: normalizeStringArray(record.recommendations),
  };
}

export function extractListingDraft(value: JsonValue | undefined, keywordMap: ListingKeywordMap, aplusBrief: ListingAplusBrief): ListingDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      title: "Listing Draft",
      bullets: [],
      description: "",
      backendSearchTerms: keywordMap.backendSearchTerms.join(", "),
      aplusBrief,
      keywordMap,
      complianceNotes: [],
      recommendation: "Draft listing for review",
      confidence: 70,
    };
  }

  const record = value as Record<string, unknown>;

  return {
    title: String(record.title ?? "Listing Draft"),
    bullets: normalizeStringArray(record.bullets),
    description: String(record.description ?? ""),
    backendSearchTerms: String(record.backendSearchTerms ?? keywordMap.backendSearchTerms.join(", ")),
    aplusBrief: extractAplusBrief(record.aplusBrief as JsonValue | undefined) || aplusBrief,
    keywordMap,
    complianceNotes: normalizeStringArray(record.complianceNotes),
    recommendation: String(record.recommendation ?? "Review listing draft"),
    confidence: typeof record.confidence === "number" ? clampScore(record.confidence) : 70,
  };
}

export function extractOpportunity(value: unknown): ProductOpportunity | null {
  if (!isRecord(value)) return null;

  return {
    opportunityId: String(value.opportunityId ?? "opportunity"),
    productIdea: String(value.productIdea ?? value.summary ?? "product idea"),
    marketplace: String(value.marketplace ?? "US"),
    category: String(value.category ?? "general"),
    targetPrice: String(value.targetPrice ?? "$0.00"),
    estimatedDemand: typeof value.estimatedDemand === "number" ? value.estimatedDemand : 0,
    competitionScore: typeof value.competitionScore === "number" ? value.competitionScore : 0,
    reviewBarrier: typeof value.reviewBarrier === "number" ? value.reviewBarrier : 0,
    keywordOpportunity: typeof value.keywordOpportunity === "number" ? value.keywordOpportunity : 0,
    trendScore: typeof value.trendScore === "number" ? value.trendScore : 0,
    differentiationOpportunity: typeof value.differentiationOpportunity === "number" ? value.differentiationOpportunity : 0,
    estimatedMargin: typeof value.estimatedMargin === "number" ? value.estimatedMargin : 0,
    riskScore: typeof value.riskScore === "number" ? value.riskScore : 0,
    opportunityScore: typeof value.opportunityScore === "number" ? value.opportunityScore : 0,
    confidence: typeof value.confidence === "number" ? value.confidence : 0,
    evidence: Array.isArray(value.evidence) ? (value.evidence as ProductEvidenceItem[]) : [],
    recommendation: String(value.recommendation ?? "Opportunity"),
  };
}

export function trimToLength(text: string, maxLength: number) {
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function hashText(text: string) {
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean);
}

export function normalizePlacement(value: unknown): ListingKeywordGroup["placement"] {
  if (value === "title" || value === "bullets" || value === "description" || value === "backend" || value === "a-plus") {
    return value;
  }

  return "description";
}

export function extractJsonObject(value: JsonValue | undefined): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JsonObject;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, toJsonValue(item)]));
  }
  return null;
}
