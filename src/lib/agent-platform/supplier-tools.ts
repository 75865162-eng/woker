import { buildSupplierEvidenceReport, supplierSelectionSource } from "./supplier-evidence";
import type { AgentToolAdapter, ToolExecutionInput, ToolExecutionResult } from "./types";
import { supplierToolAdapterId } from "./supplier-catalog";
import { extractJsonObject, toJsonValue } from "./supplier-values";

export function createSupplierMcpAdapter(clock: () => Date = () => new Date()): AgentToolAdapter {
  return {
    adapterId: supplierToolAdapterId,
    async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
      const startedAt = clock().getTime();
      const snapshot = extractJsonObject(input.input);
      const source = supplierSelectionSource(snapshot.productReport);
      if (!source) throw new Error("NEEDS_DATA: productReport.selectionSource 缺失，无法核实供应商、报价、MOQ、交期及运输费用。");
      const report = buildSupplierEvidenceReport(source, String(snapshot.goal ?? "供应线索核实"), String(snapshot.marketplace ?? "US"), String(snapshot.productSummary ?? "待核实产品方案"), clock().toISOString());
      const outputs: Record<string, unknown> = {
        "supplier.product.load": { prd: snapshot.prd, productReport: snapshot.productReport },
        "supplier.database.search": { suppliers: report.supplierRecommendations },
        "supplier.quotation.analyze": { quotations: report.quotationAnalysis },
        "supplier.recommendation.compose": { suppliers: report.supplierRecommendations },
        "supplier.rfq.draft": report.rfqDraft,
        "supplier.project.draft": report.supplierProjectDraft,
      };
      if (!(input.toolId in outputs)) throw new Error(`不可用的供应工具：${input.toolId}`);
      return {
        output: toJsonValue({ ...extractJsonObject(toJsonValue(outputs[input.toolId])), selectionFileId: source.fileId, selectionSha256: source.sha256 }),
        latencyMs: Math.max(clock().getTime() - startedAt, 1),
      };
    },
  };
}
