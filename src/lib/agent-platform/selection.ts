import type { AgentToolAdapter, AgentToolDefinition } from "./types";

export const selectionTool: AgentToolDefinition = {
  toolId: "market.selection.run", name: "Round B Selection Evidence",
  description: "Round B Playwright evidence integration point. Unavailable until a real evidence runner is installed.",
  inputSchema: { type: "object", required: ["marketplace"], properties: { marketplace: { type: "string" }, keyword: { type: "string" }, category: { type: "string" } } },
  outputSchema: { type: "object", properties: { opportunities: { type: "array" }, evidence: { type: "array" } } },
  permission: ["market.read.category"], riskLevel: "LOW", timeout: 5000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0, retryableErrors: [] },
  adapterId: "market-selection-adapter", enabled: true,
};

export function createSelectionAdapter(): AgentToolAdapter {
  return {
    adapterId: "market-selection-adapter",
    async execute() {
      throw { code: "NOT_IMPLEMENTED", message: "Round B CLI 已有本机实现，但尚未接入 Agent Runtime：缺少组织/工作区隔离的受控 runner、job 状态和版本化机会证据映射。未启动采集，未创建 SKU。", retryable: false };
    },
  };
}
