import type { ObjectJson, Transport } from "@/lib/selection-research/types";
import { ToolNotDispatchedError } from "@/lib/selection-research/types";

/** Refresh configuration before discovery and dispatch; saved approvals cannot retain revoked access. */
export function liveMarketTransport(resolve: () => Promise<Transport | undefined>): Transport {
  const current = async () => {
    try {
      const transport = await resolve();
      if (!transport) throw new ToolNotDispatchedError("RUNTIME_TOOL_UNAVAILABLE_OR_FORBIDDEN");
      return transport;
    } catch {
      // The adapter has not been invoked: configuration/permission failures cannot be billable.
      throw new ToolNotDispatchedError("RUNTIME_TOOL_UNAVAILABLE_OR_FORBIDDEN");
    }
  };
  return {
    async listTools(signal) { return (await current()).listTools(signal); },
    async callTool(name, args, signal, schema) { return (await current()).callTool(name, args, signal, schema); },
  };
}
export type MarketProviderAccess = { provider: "sellersprite" | "xiyou"; configured: boolean; status: "configured_not_probed" | "disabled_or_missing" | "configuration_unavailable" };
export function marketAccessSummary(authenticated: boolean, canResearch: boolean, providers: MarketProviderAccess[]): ObjectJson {
  return {
    authenticated, direct_market_access: false, paid_tools: [], estimated_cost: null, cost_status: "unknown", approval_required: true,
    research_access: canResearch && providers.some(p => p.configured),
    providers: providers.map(p => ({ ...p, allowed: canResearch && p.configured })),
    reason: !canResearch ? "RESEARCH_PERMISSION_REQUIRED" : "PAID_CALLS_REQUIRE_PERSISTED_RESEARCH_APPROVAL",
    registry_checked: false,
  };
}
