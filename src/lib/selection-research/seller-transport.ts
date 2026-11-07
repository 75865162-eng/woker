import { listSellerSpriteRemoteTools, callSellerSpriteRemoteTool, type SellerSpriteMcpSettings } from "@/lib/integrations/sellersprite";
import { canonicalResearchTool } from "./engine";
import type { ToolPolicy, Transport } from "./types";

const stages: Record<string, number[]> = {
  market_find_products: [1, 2, 5], market_find_node: [1], market_scan_node: [1, 2],
  market_get_asin: [1, 2, 3, 5], market_research_keyword: [2, 5], market_mine_keywords: [1, 2],
  market_get_reviews: [3, 5], market_list_competitors: [2, 3], market_aba_trend: [2],
};

export function sellerSpritePolicy(tool: { name: string; description?: string }): ToolPolicy | null {
  const canonical = canonicalResearchTool(tool.name);
  if (!canonical) return null;
  return {
    provider: "sellersprite", paid: true, units: 1, unit: "calls",
    pricingSource: (tool.description ?? "SellerSprite runtime registered read-only tool") + " Price per request is not represented as a fixed credit amount; each outbound call requires human review.",
    maxCalls: 3, stages: stages[canonical] ?? [1, 2, 3, 4, 5],
  };
}

/** Current user's existing SellerSprite setting; keys remain inside this transport. */
export function createSellerSpriteResearchTransport(settings: SellerSpriteMcpSettings): Transport {
  return {
    async listTools() {
      const remote = await listSellerSpriteRemoteTools(settings);
      return remote.filter((tool) => sellerSpritePolicy(tool) && tool.annotations?.readOnlyHint !== false).map((tool) => ({
        name: tool.name, description: tool.description,
        inputSchema: tool.inputSchema as never, annotations: { readOnlyHint: true },
      }));
    },
    async callTool(name, args, signal, expectedSchema) {
      return await callSellerSpriteRemoteTool(settings, name, args, signal, expectedSchema) as never;
    },
  };
}
