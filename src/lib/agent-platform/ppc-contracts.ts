import type { AgentMemoryEntry, JsonValue } from "./types";
import type { AdjustmentDraft, CampaignGroup, OverallAdDataRow, PerformanceRow } from "@/lib/types";
import { type GatedPpcReport } from "./ppc-inventory-gate";

export interface PpcEvidenceItem {
  claim: string;
  dataSource: string;
  toolId: string;
  toolCallId?: string;
  metric: string;
  value: JsonValue;
  timestamp: string;
}

export interface PpcDiagnosisItem {
  severity: "low" | "medium" | "high";
  issue: string;
  impact: string;
  evidence: PpcEvidenceItem[];
}

export interface PpcOpportunityItem {
  opportunityId: string;
  title: string;
  type: "scale" | "fix" | "defend" | "negative_keyword" | "structure";
  score: number;
  rationale: string;
  evidence: PpcEvidenceItem[];
}

export interface PpcBidRecommendationItem {
  rowId: string;
  campaignGroupId: string;
  keyword: string;
  target: string;
  currentBid: number;
  suggestedBid: number;
  deltaPercent: number;
  recommendation: string;
  confidence: number;
  evidence: PpcEvidenceItem[];
}

export interface PpcNegativeRecommendationItem {
  term: string;
  matchType: string;
  recommendation: string;
  confidence: number;
  evidence: PpcEvidenceItem[];
}

export interface PpcCampaignRecommendationItem {
  title: string;
  recommendation: string;
  confidence: number;
  evidence: PpcEvidenceItem[];
}

export interface PpcAnalysisReport {
  goal: string;
  marketplace: string;
  scope: {
    campaignGroupIds: string[];
    campaignGroupNames: string[];
    workspaceMode?: string;
  };
  summary: string;
  diagnosis: PpcDiagnosisItem[];
  opportunities: PpcOpportunityItem[];
  bidRecommendations: PpcBidRecommendationItem[];
  negativeRecommendations: PpcNegativeRecommendationItem[];
  campaignRecommendations: PpcCampaignRecommendationItem[];
  actionPlan: string[];
  evidence: PpcEvidenceItem[];
  recommendation: string;
  generatedAt: string;
}

export interface PpcExecutionOutput {
  report: PpcAnalysisReport;
  evidence: PpcEvidenceItem[];
  adjustmentDrafts: AdjustmentDraft[];
  /** Present only when the caller supplied an inventory constraint resolver. */
  inventoryGate?: GatedPpcReport["gate"] | null;
  blockedBidIncreases?: GatedPpcReport["blocked"];
  amazonAdsPlan?: JsonValue;
  memoryItems?: AgentMemoryEntry[];
}

export interface PpcExecutionRequest {
  chainHandoff?: unknown;
  naturalLanguageGoal?: string;
  marketplace?: string;
  campaignGroupId?: string;
  workspaceUnitId?: string;
  workspaceMode?: string;
  campaignGroups?: CampaignGroup[];
  performanceRows?: PerformanceRow[];
  overallAdDataRows?: OverallAdDataRow[];
  productContext?: JsonValue;
  sellerSpriteKeywords?: JsonValue;
  historicalData?: JsonValue;
  currentData?: Record<string, unknown>;
  targetAcos?: number;
  targetRoas?: number;
  targetMargin?: number;
  /** MSKU used to join the replenishment plan; enables the inventory gate. */
  sellerSku?: string;
  /** Length of the advertising report window in days; required for daily-spend caps. */
  adsWindowDays?: number;
  /** Unit economics for the gate; without a gross margin no boost is allowed. */
  productEconomics?: {
    unitPrice?: number | null;
    unitCost?: number | null;
    grossMarginPct?: number | null;
    targetNetMarginPct?: number;
    currency?: string | null;
  };
  context?: Record<string, unknown>;
}
