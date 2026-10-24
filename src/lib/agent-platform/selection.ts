import { buildSelectionMarketOutput, SelectionEvidenceError } from "./selection-evidence";
import { isObject } from "./handoff";
import type { AgentToolAdapter, AgentToolDefinition, JsonValue } from "./types";

export const selectionTool: AgentToolDefinition = {
  toolId: "market.selection.run", name: "Round B Selection Evidence",
  description: "Read scoped Round B research artifacts and produce evidence-backed Market output. Does not start collection or create products.",
  inputSchema: { type: "object", required: ["marketplace"], properties: { marketplace: { type: "string" }, fileId: { type: "string" }, keyword: { type: "string" }, category: { type: "string" } } },
  outputSchema: { type: "object", properties: { report: { type: "object" }, productOpportunities: { type: "array" }, evidence: { type: "array" } } },
  permission: ["market.read.category"], riskLevel: "LOW", timeout: 5000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0, retryableErrors: [] },
  adapterId: "market-selection-adapter", enabled: true,
};

export function createSelectionAdapter(options: { loadEvidence?: (fileId: string) => Promise<{ value: unknown; source: { fileId: string; sha256: string } }> } = {}): AgentToolAdapter {
  return {
    adapterId: "market-selection-adapter",
    async execute(input) {
      const value = isObject(input.input) ? input.input : {};
      if (value.marketplace !== "US") throw { code: "INVALID_INPUT", message: "Round B 仅支持 Amazon US。", retryable: false };
      if (options.loadEvidence && typeof value.fileId === "string" && value.fileId) {
        try {
          const evidence = await options.loadEvidence(value.fileId);
          const output = buildSelectionMarketOutput(evidence.value, evidence.source);
          if (typeof value.keyword === "string" && value.keyword.trim() && output.report.keyword !== value.keyword.trim()) throw new SelectionEvidenceError("关键词与已上传证据不匹配，请重新核对研究目标。");
          return { output: output as unknown as JsonValue, latencyMs: 1 };
        } catch (error) {
          if (error instanceof SelectionEvidenceError) throw { code: "INVALID_EVIDENCE", message: error.message, retryable: false };
          throw { code: "EVIDENCE_UNAVAILABLE", message: "读取选品证据失败，请核对上传记录与工作区。", retryable: false };
        }
      }
      throw { code: "NOT_IMPLEMENTED", message: "请先上传 Round B draft.json。后台实时采集 runner/job 尚未接入；未启动采集，未创建 SKU。", retryable: false };
    },
  };
}
