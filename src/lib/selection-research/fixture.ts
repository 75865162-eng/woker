import type { Action, Agent, ObjectJson, StageResult, ToolDefinition, ToolPolicy, Transport } from "./types";

/** Isolated transport fixture, never substituted when live transport fails. */
export function researchFixture(): { agent: Agent; transport: Transport; policies: Record<string, ToolPolicy> } {
  const definitions: ToolDefinition[] = [
    { name: "market_find_products", inputSchema: { type: "object", properties: { keyword: { type: "string" }, marketplace: { type: "string" } }, required: ["keyword"] } },
    { name: "market_research_keyword", inputSchema: { type: "object", properties: { keywords: { type: "string" }, marketplace: { type: "string" } }, required: ["keywords"] } },
    { name: "market_get_reviews", inputSchema: { type: "object", properties: { asin: { type: "string" }, stars: { type: "string" } }, required: ["asin", "stars"] } },
  ];
  const policies = Object.fromEntries(definitions.map((tool) => [tool.name, { provider: "fixture", paid: false, units: 0, unit: "credits", maxCalls: 10, stages: [1, 2, 3, 4, 5], pricingSource: "Isolated test fixture: no remote calls or charges" } satisfies ToolPolicy]));
  return {
    policies,
    transport: { async listTools() { return structuredClone(definitions); }, async callTool(name, args) {
      return { ok: true, source: "isolated-fixture", synthetic: true, tool: name, arguments: args, note: "仅验证流程，不包含真实销量、搜索量、评论或税率" };
    } },
    agent: { async next({ run }): Promise<Action> {
      const calls = run.calls.filter((call) => call.stage === run.stage && call.status === "SUCCEEDED");
      if (run.stage === 1 && !calls.length) return { type: "call", tool: "market_find_products", arguments: { keyword: run.requirement, marketplace: run.marketplace } };
      if (run.stage === 2 && !calls.length) return { type: "call", tool: "market_research_keyword", arguments: { keywords: run.selectedCandidateId!, marketplace: run.marketplace } };
      if (run.stage === 3 && calls.length < 2) return { type: "call", tool: "market_get_reviews", arguments: { asin: "FIXTURE-ASIN", stars: calls.length ? "4,5" : "1,2,3" } };
      const result: StageResult = { summary: `离线流程测试阶段 ${run.stage}，不构成市场研究结论。`, claims: [{ text: calls.length ? "已保存隔离样本响应；没有真实市场记录。" : "采购、运费、广告和费用均待真实数据验证。", kind: calls.length ? "observed" : "assumption", evidenceIds: calls.map((call) => call.id) }] };
      if (run.stage === 1) result.candidates = [1, 2, 3].map((i) => ({ id: `fixture-${i}`, name: `流程测试方向 ${i}（非市场建议）` }));
      if (run.stage === 4) result.claims.push({ text: "税率未核验；未设置任何历史或示例税率。", topic: "tariff", kind: "assumption", evidenceIds: [] });
      if (run.stage === 5) result.verdict = "NEEDS_VALIDATION";
      return { type: "complete", result };
    } },
  };
}

export function parseAction(text: string): ObjectJson {
  const parsed: unknown = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_AGENT_JSON");
  return parsed as ObjectJson;
}
