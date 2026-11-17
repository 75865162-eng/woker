import type { AgentMemoryEntry, JsonValue } from "./types";
import type { ProductDevelopmentReport, ProductEvidenceItem, ProductHandoffPayload, ProductPrdSection } from "./product";

export interface SupplierQuotation {
  supplierId: string;
  supplierName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  moq: string;
  unitPrice: string;
  shippingEstimate: string;
  leadTime: string;
  sampleCost: string;
  notes: string;
  score: number | null;
  sourceUrl?: string;
}

export interface SupplierRecommendation {
  sourceUrl?: string;
  supplierId: string;
  supplierName: string;
  summary: string;
  strengths: string[];
  risks: string[];
  confidence: number;
}

export interface SupplierRfQSection {
  subject: string;
  objective: string;
  productSummary: string;
  requiredCapabilities: string[];
  targetPrice: string;
  targetLeadTime: string;
  questions: string[];
}

export interface SupplierAnalysisReport {
  selectionSource?: NonNullable<import("./market").MarketResearchReport["selectionSource"]>;
  sourcingStatus?: "NEEDS_DATA" | "NEEDS_VERIFICATION";
  goal: string;
  marketplace: string;
  category?: string;
  productSummary: string;
  supplierRecommendations: SupplierRecommendation[];
  quotationAnalysis: SupplierQuotation[];
  rfqDraft: SupplierRfQSection;
  supplierProjectDraft: {
    projectName: string;
    objective: string;
    stages: Array<{
      name: string;
      goal: string;
      owner: string;
    }>;
    nextStep: string;
    risks: string[];
  };
  evidence: ProductEvidenceItem[];
  summary: string;
  recommendation: string;
  generatedAt: string;
}

export interface SupplierExecutionOutput {
  report: SupplierAnalysisReport;
  evidence: ProductEvidenceItem[];
  memoryItems?: AgentMemoryEntry[];
}

export interface SupplierExecutionRequest {
  chainHandoff?: unknown;
  naturalLanguageGoal?: string;
  marketplace?: string;
  category?: string;
  prd?: ProductPrdSection | null;
  productReport?: ProductDevelopmentReport | null;
  productHandoff?: ProductHandoffPayload | null;
  currentSkuContext?: JsonValue;
  context?: Record<string, unknown>;
}
