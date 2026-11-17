import type { AgentMemoryEntry, JsonValue } from "./types";

export type MarketRange = {
  min?: number;
  max?: number;
};

export interface MarketResearchInput {
  naturalLanguageGoal: string;
  marketplace: string;
  keyword?: string;
  category?: string;
  asin?: string;
  priceRange?: MarketRange;
  salesRange?: MarketRange;
  reviewRange?: MarketRange;
  competition?: string;
  targetMargin?: number;
  productConstraints: string[];
  currentSkuContext?: JsonValue;
}

export interface MarketEvidenceItem {
  claim: string;
  dataSource: string;
  toolId: string;
  toolCallId?: string;
  metric: string;
  value: JsonValue;
  timestamp: string;
}

export interface BlueOceanRadar {
  blueOceanIndex: number | null;
  demandStrength: number | null;
  competitionStrength: number | null;
  entryBarrier: number | null;
  explanation: string;
}

export interface ProductOpportunity {
  opportunityId: string;
  productIdea: string;
  marketplace: string;
  category: string;
  targetPrice: string;
  estimatedDemand: number | null;
  competitionScore: number | null;
  reviewBarrier: number | null;
  keywordOpportunity: number | null;
  trendScore: number | null;
  differentiationOpportunity: number | null;
  estimatedMargin: number | null;
  riskScore: number | null;
  opportunityScore: number | null;
  evidenceCompleteness?: number;
  scoreBasis?: "evidence_completeness";
  confidence: number;
  evidence: MarketEvidenceItem[];
  recommendation: string;
}

export interface MarketResearchReport {
  goal: string;
  marketplace: string;
  keyword?: string;
  category?: string;
  asin?: string;
  searchStrategy: Array<{
    step: string;
    toolId: string;
    rationale: string;
  }>;
  blueOceanRadar: BlueOceanRadar;
  signals: {
    demandStrength: number | null;
    competitionStrength: number | null;
    entryBarrier: number | null;
    keywordOpportunity: number | null;
    trendScore: number | null;
    reviewBarrier: number | null;
    differentiationOpportunity: number | null;
    estimatedMargin: number | null;
  };
  productOpportunities: ProductOpportunity[];
  evidence: MarketEvidenceItem[];
  summary: string;
  recommendation: string;
  generatedAt: string;
  selectionSource?: { fileId: string; sha256: string; schemaVersion: number; slug: string; importedAt: string; stale: boolean; suppliers: Array<{ title: string; url: string; shopName: string; price: string; moq: string }> };
}

export interface MarketExecutionOutput {
  report: MarketResearchReport;
  blueOceanRadar: BlueOceanRadar;
  productOpportunities: ProductOpportunity[];
  evidence: MarketEvidenceItem[];
  memoryItems?: AgentMemoryEntry[];
}

export interface MarketExecutionRequest {
  chainHandoff?: unknown;
  selectionRun?: boolean;
  selectionFileId?: string;
  naturalLanguageGoal?: string;
  marketplace?: string;
  keyword?: string;
  category?: string;
  asin?: string;
  priceRange?: MarketRange;
  salesRange?: MarketRange;
  reviewRange?: MarketRange;
  competition?: string;
  targetMargin?: number;
  productConstraints?: string[] | string;
  context?: Record<string, unknown>;
}
