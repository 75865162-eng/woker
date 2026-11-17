import type { AgentMemoryEntry, JsonValue } from "./types";
import type { ProductDevelopmentReport, ProductEvidenceItem, ProductHandoffPayload } from "./product";
import type { MarketResearchReport, ProductOpportunity } from "./market";

export interface ListingKeywordGroup {
  placement: "title" | "bullets" | "description" | "backend" | "a-plus";
  keywords: string[];
  intent: string;
  rationale: string;
}

export interface ListingKeywordMap {
  primaryKeywords: string[];
  secondaryKeywords: string[];
  longTailKeywords: string[];
  backendSearchTerms: string[];
  competitorGaps: string[];
  groups: ListingKeywordGroup[];
  notes: string;
}

export interface ListingTitleDraft {
  title: string;
  characterCount: number;
  primaryKeywords: string[];
  secondaryKeywords: string[];
  rationale: string;
}

export interface ListingBulletDraft {
  bullet: string;
  keywordFocus: string[];
  benefit: string;
  evidenceNotes: string[];
}

export interface ListingDescriptionDraft {
  summary: string;
  paragraphs: string[];
  keywordCoverage: string[];
  complianceNotes: string[];
}

export interface ListingAplusBrief {
  objective: string;
  modules: Array<{
    moduleName: string;
    message: string;
    layout: string;
    visualNotes: string[];
  }>;
  imageStoryline: string[];
  recommendations: string[];
}

export interface ListingDraft {
  title: string;
  bullets: string[];
  description: string;
  backendSearchTerms: string;
  aplusBrief: ListingAplusBrief;
  keywordMap: ListingKeywordMap;
  complianceNotes: string[];
  recommendation: string;
  confidence: number;
}

export interface ListingAnalysisReport {
  goal: string;
  marketplace: string;
  category?: string;
  productSummary: string;
  keywordMap: ListingKeywordMap;
  titleDraft: ListingTitleDraft;
  bulletDrafts: ListingBulletDraft[];
  descriptionDraft: ListingDescriptionDraft;
  aplusBrief: ListingAplusBrief;
  listingDraft: ListingDraft;
  evidence: ProductEvidenceItem[];
  summary: string;
  recommendation: string;
  generatedAt: string;
}

export interface ListingExecutionOutput {
  report: ListingAnalysisReport;
  evidence: ProductEvidenceItem[];
  memoryItems?: AgentMemoryEntry[];
}

export interface ListingExecutionRequest {
  chainHandoff?: unknown;
  supplierReport?: JsonValue;
  naturalLanguageGoal?: string;
  marketplace?: string;
  category?: string;
  productOpportunity?: ProductOpportunity | null;
  marketReport?: MarketResearchReport | null;
  productReport?: ProductDevelopmentReport | null;
  productHandoff?: ProductHandoffPayload | null;
  sellerSpriteKeywords?: JsonValue;
  competitors?: JsonValue;
  currentSkuContext?: JsonValue;
  context?: Record<string, unknown>;
}
