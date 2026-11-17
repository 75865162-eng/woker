import type { AgentDefinition, AgentMemoryEntry, JsonValue } from "./types";
import type { ProductEvidenceItem, ProductPrdSection } from "./product";
import type { SupplierRecommendation, SupplierRfQSection, SupplierAnalysisReport } from "./supplier-contracts";
import { toJsonValue } from "./supplier-values";

export function buildEvidence(input: {
  productLoadResult: { output?: JsonValue; toolCall?: { id?: string } };
  supplierSearchResult: { output?: JsonValue; toolCall?: { id?: string } };
  quotationResult: { output?: JsonValue; toolCall?: { id?: string } };
  recommendationResult: { output?: JsonValue; toolCall?: { id?: string } };
  rfqResult: { output?: JsonValue; toolCall?: { id?: string } };
  projectResult: { output?: JsonValue; toolCall?: { id?: string } };
  generatedAt: string;
}): ProductEvidenceItem[] {
  return [
    evidenceItem({
      claim: "Product context normalized",
      dataSource: "Supplier MCP Adapter",
      toolId: "supplier.product.load",
      toolCallId: input.productLoadResult.toolCall?.id,
      metric: "product-context",
      value: input.productLoadResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Supplier candidates found",
      dataSource: "Supplier MCP Adapter",
      toolId: "supplier.database.search",
      toolCallId: input.supplierSearchResult.toolCall?.id,
      metric: "supplier-candidates",
      value: input.supplierSearchResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Quotation analysis completed",
      dataSource: "Supplier MCP Adapter",
      toolId: "supplier.quotation.analyze",
      toolCallId: input.quotationResult.toolCall?.id,
      metric: "quotation-analysis",
      value: input.quotationResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Supplier recommendation drafted",
      dataSource: "Supplier MCP Adapter",
      toolId: "supplier.recommendation.compose",
      toolCallId: input.recommendationResult.toolCall?.id,
      metric: "supplier-recommendation",
      value: input.recommendationResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "RFQ drafted",
      dataSource: "Supplier MCP Adapter",
      toolId: "supplier.rfq.draft",
      toolCallId: input.rfqResult.toolCall?.id,
      metric: "rfq-draft",
      value: input.rfqResult.output ?? null,
      timestamp: input.generatedAt,
    }),
    evidenceItem({
      claim: "Sourcing project drafted",
      dataSource: "Supplier MCP Adapter",
      toolId: "supplier.project.draft",
      toolCallId: input.projectResult.toolCall?.id,
      metric: "project-draft",
      value: input.projectResult.output ?? null,
      timestamp: input.generatedAt,
    }),
  ];
}

export function buildSummary(prd: ProductPrdSection | null, projectDraft: { projectName: string }, recommendations: SupplierRecommendation[]) {
  const productSummary = prd ? prd.summary : "the selected product concept";
  const supplierName = recommendations[0]?.supplierName ?? "a shortlisted supplier";
  return `${productSummary} can be sourced through ${supplierName}, with RFQ and ${projectDraft.projectName} prepared for review.`;
}

export function buildRecommendation(recommendations: SupplierRecommendation[], rfqDraft: SupplierRfQSection, projectDraft: { nextStep: string }) {
  return `Use ${recommendations[0]?.supplierName ?? "the top supplier"} as the first RFQ target, then review quote spread, sample cost, lead time, and ${rfqDraft.targetLeadTime} against ${projectDraft.nextStep.toLowerCase()}.`;
}

export function buildMemoryItems(input: {
  execution: { id: string; agentDefinitionId: string };
  definition: AgentDefinition;
  report: SupplierAnalysisReport;
  generatedAt: string;
  requestedByUserId?: string;
}): AgentMemoryEntry[] {
  const scopeKey = `${input.report.marketplace}:${input.report.category ?? input.report.productSummary ?? "supplier"}:${input.execution.id}`;

  return [
    {
      id: `memory-${input.execution.id}-supplier`,
      agentDefinitionId: input.definition.id,
      scope: "supplier-planning",
      scopeKey,
      summary: `${input.report.supplierProjectDraft.projectName} drafted with RFQ and supplier recommendations.`,
      data: toJsonValue({
        report: input.report,
        requestedByUserId: input.requestedByUserId ?? null,
      }),
      sourceExecutionId: input.execution.id,
      confidence: input.report.selectionSource ? 0 : Math.max(0.55, input.report.supplierRecommendations[0]?.confidence ?? 0.7),
      createdAt: input.generatedAt,
      updatedAt: input.generatedAt,
    },
  ];
}

export function evidenceItem(input: {
  claim: string;
  dataSource: string;
  toolId: string;
  metric: string;
  value: JsonValue;
  toolCallId?: string;
  timestamp?: string;
}): ProductEvidenceItem {
  return {
    claim: input.claim,
    dataSource: input.dataSource,
    toolId: input.toolId,
    toolCallId: input.toolCallId,
    metric: input.metric,
    value: input.value,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}
