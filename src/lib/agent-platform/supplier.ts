import { buildSupplierEvidenceReport, supplierSelectionSource } from "./supplier-evidence";
import type { AgentEventName, AgentRuntimeExecutor, JsonValue } from "./types";
import type { ProductDevelopmentReport, ProductPrdSection } from "./product";
import type { SupplierExecutionRequest, SupplierAnalysisReport } from "./supplier-contracts";
import { normalizeSupplierExecutionInput, summarizeProduct, extractSupplierRecommendations, extractSupplierQuotations, extractSupplierRecommendationItems, extractRfQSection, extractProjectDraft } from "./supplier-normalization";
import { toJsonValue, extractJsonObject, isRecord, clampScore } from "./supplier-values";
import { buildSummary, buildRecommendation, buildEvidence, buildMemoryItems } from "./supplier-reporting";

export function createSupplierAgentExecutionExecutor(options: {
  request: SupplierExecutionRequest;
  requestedByUserId?: string;
  clock?: () => Date;
}): AgentRuntimeExecutor {
  const clock = options.clock ?? (() => new Date());
  const normalizedInput = normalizeSupplierExecutionInput(options.request, {});

  return async ({ execution, definition, callTool: gatewayCallTool, recordTrace, emitEvent }) => {
    const selectionSource = supplierSelectionSource(normalizedInput.productReport);
    if (!selectionSource) throw new Error("NEEDS_DATA: productReport.selectionSource 缺失，供应商与报价未核实，不能生成供应分析报告。");
    const callTool: typeof gatewayCallTool = async (toolId, input) => {
      const result = await gatewayCallTool(toolId, selectionSource ? toJsonValue({ ...extractJsonObject(input),
        productReport: normalizedInput.productReport, goal: normalizedInput.naturalLanguageGoal,
        marketplace: normalizedInput.marketplace, productSummary: summarizeProduct(normalizedInput.prd, normalizedInput.productReport),
      }) : input);
      if (selectionSource && (result.status !== "SUCCEEDED" || !result.output || typeof result.output !== "object" || Array.isArray(result.output))) {
        throw new Error(`Round B 供应工具 ${toolId} 未成功，已停止交接报告生成。`);
      }
      if (selectionSource) {
        const output = extractJsonObject(result.output);
        const requiredArray: Record<string, string> = { "supplier.database.search": "suppliers", "supplier.quotation.analyze": "quotations", "supplier.recommendation.compose": "suppliers", "supplier.rfq.draft": "questions", "supplier.project.draft": "stages" };
        const field = requiredArray[toolId];
        if (output.selectionFileId !== selectionSource.fileId || output.selectionSha256 !== selectionSource.sha256 || (field && !Array.isArray(output[field]))) {
          throw new Error(`Round B 供应工具 ${toolId} 返回的证据不匹配，已停止报告生成。`);
        }
      }
      return result;
    };
    const generatedAt = clock().toISOString();

    recordTrace(
      "decision",
      "Supplier brief parsed",
      toJsonValue({
        naturalLanguageGoal: normalizedInput.naturalLanguageGoal,
        marketplace: normalizedInput.marketplace,
        category: normalizedInput.category,
      }),
    );
    emitEvent("decision.made" as AgentEventName, {
      executionId: execution.id,
      summary: "Supplier brief parsed and sourcing workflow prepared.",
      marketplace: normalizedInput.marketplace,
    } as JsonValue);

    const productLoadResult = await callTool(
      "supplier.product.load",
      toJsonValue({
        prd: normalizedInput.prd,
        productReport: normalizedInput.productReport,
        productHandoff: normalizedInput.productHandoff,
        marketplace: normalizedInput.marketplace,
        category: normalizedInput.category,
      }),
    );
    const productContext = extractJsonObject(productLoadResult.output);

    const supplierSearchResult = await callTool(
      "supplier.database.search",
      toJsonValue({
        marketplace: normalizedInput.marketplace,
        category: normalizedInput.category,
        prd: normalizedInput.prd ?? productContext.prd,
      }),
    );
    const suppliers = extractSupplierRecommendations(supplierSearchResult.output);

    const quotationResult = await callTool(
      "supplier.quotation.analyze",
      toJsonValue({
        suppliers,
        prd: normalizedInput.prd ?? productContext.prd,
      }),
    );
    const quotations = extractSupplierQuotations(quotationResult.output);

    const recommendationResult = await callTool(
      "supplier.recommendation.compose",
      toJsonValue({
        suppliers,
        quotations,
      }),
    );
    const recommendations = extractSupplierRecommendationItems(recommendationResult.output, suppliers, quotations);

    const rfqResult = await callTool(
      "supplier.rfq.draft",
      toJsonValue({
        recommendations,
        prd: normalizedInput.prd ?? productContext.prd,
      }),
    );
    const rfqDraft = extractRfQSection(rfqResult.output);

    const projectResult = await callTool(
      "supplier.project.draft",
      toJsonValue({
        rfqDraft,
        recommendations,
      }),
    );
    const projectDraft = extractProjectDraft(projectResult.output);

    const sourcePrd = normalizedInput.prd ?? (isRecord(productContext.prd) ? (productContext.prd as unknown as ProductPrdSection) : null);
    const sourceProductReport = normalizedInput.productReport ?? (isRecord(productContext.productReport) ? (productContext.productReport as unknown as ProductDevelopmentReport) : null);
    const summary = buildSummary(sourcePrd, projectDraft, recommendations);
    const recommendation = buildRecommendation(recommendations, rfqDraft, projectDraft);
    const evidence = buildEvidence({
      productLoadResult,
      supplierSearchResult,
      quotationResult,
      recommendationResult,
      rfqResult,
      projectResult,
      generatedAt,
    });
    let report: SupplierAnalysisReport = {
      goal: normalizedInput.naturalLanguageGoal,
      marketplace: normalizedInput.marketplace,
      category: normalizedInput.category,
      productSummary: summarizeProduct(sourcePrd, sourceProductReport),
      supplierRecommendations: recommendations,
      quotationAnalysis: quotations,
      rfqDraft,
      supplierProjectDraft: projectDraft,
      evidence,
      summary,
      recommendation,
      generatedAt,
    };

    if (selectionSource) {
      const evidenceReport = buildSupplierEvidenceReport(selectionSource, normalizedInput.naturalLanguageGoal, normalizedInput.marketplace, report.productSummary, generatedAt);
      const searchCall = "toolCall" in supplierSearchResult && isRecord(supplierSearchResult.toolCall) ? supplierSearchResult.toolCall : {};
      report = { ...evidenceReport, category: normalizedInput.category, supplierRecommendations: recommendations, quotationAnalysis: quotations, rfqDraft, supplierProjectDraft: projectDraft, evidence: evidenceReport.evidence.map((item) => ({ ...item, toolCallId: typeof searchCall.id === "string" ? searchCall.id : undefined })) };
    }

    const memoryItems = buildMemoryItems({
      execution,
      definition,
      report,
      generatedAt,
      requestedByUserId: options.requestedByUserId,
    });

    recordTrace("recommendation", "Supplier plan drafted", report as unknown as JsonValue);
    emitEvent("recommendation.created", report as unknown as JsonValue);

    return {
      recommendation: {
        summary: report.recommendation,
        evidence: report.evidence,
        risks: report.supplierProjectDraft.risks,
        confidence: selectionSource ? 0 : clampScore(recommendations[0]?.confidence ?? 0.7) / 100,
        nextAction: "Review supplier shortlist and RFQ draft before sourcing approval.",
      },
      decision: {
        summary: report.summary,
        rationale: selectionSource ? "仅整理用户提供的供应线索，供应商与报价尚未核实。" : "Supplier planning is complete and ready for human review.",
        confidence: selectionSource ? 0 : clampScore(recommendations[0]?.confidence ?? 0.7) / 100,
        nextStep: "Review sourcing project draft and RFQ",
      },
      output: toJsonValue({
        report,
        evidence: report.evidence,
      }),
      tokenUsage: 150,
      costCents: 0,
      memoryItems,
    };
  };
}

export type { SupplierQuotation, SupplierRecommendation, SupplierRfQSection, SupplierAnalysisReport, SupplierExecutionOutput, SupplierExecutionRequest } from "./supplier-contracts";
export { supplierAgentId, supplierHandoffStorageKey } from "./supplier-constants";
export { supplierAgentDefinition, supplierToolDefinitions } from "./supplier-catalog";
export { createSupplierMcpAdapter } from "./supplier-tools";
export { supplierEvaluationCases } from "./supplier-evaluations";