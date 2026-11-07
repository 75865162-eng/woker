import { listTools } from "./catalog";
import { runCatalogTool } from "./tool-execution";
import { rejectCredentials, validate, stableJson } from "@/lib/selection-research/schema";
import { ToolNotDispatchedError, type Json, type ObjectJson, type ToolDefinition, type Transport } from "@/lib/selection-research/types";

export type ProviderId = "erp" | "sellersprite" | "xiyou";
export type RuntimeTool = ToolDefinition & { provider: ProviderId | "skills"; remoteName: string; permission: "read" | "approval_required"; availability: "available" | "blocked" };
export type ProviderStatus = { provider: ProviderId; status: "connected" | "not_connected" | "unavailable"; toolCount: number; reason?: string };
export type RuntimeProvider = { id: ProviderId; transport?: Transport; reason?: string; isReadOnly(tool: ToolDefinition): boolean };
export class RuntimeToolError extends ToolNotDispatchedError {}
const skillNames = new Set(["meta_search_skills", "meta_load_skill", "meta_list_workflows"]);
/** Reviewed read endpoints observed in the fixed Xiyou runtime registry. Missing hints never grant arbitrary tools. */
export const xiyouResearchReadTools = new Set(["get_asin_info", "get_asin_traffic", "get_asin_keywords", "get_asin_traffic_trends", "get_asin_keyword_traffic_trends", "get_asin_bsr_trends", "get_asin_variations"]);
export const runtimeName = (provider: ProviderId, name: string) => `${provider}__${name}`;

/** Request-scoped registry. Only actual adapter definitions are exposed; shipped business catalog is never used. */
export function createRuntimeTools(providers: RuntimeProvider[]) {
  async function discover(selected?: ProviderId | "skills") {
    const tools: RuntimeTool[] = listTools().filter(tool => skillNames.has(tool.name)).map(tool => ({
      name: tool.name, description: tool.name === "meta_list_workflows" ? "List shipped workflow templates only. Does not list saved workflows or schedules." : tool.description, inputSchema: tool.inputSchema as ObjectJson,
      annotations: { readOnlyHint: true }, provider: "skills", remoteName: tool.name, permission: "read", availability: "available",
    }));
    const statuses: ProviderStatus[] = [];
    // Bound provider count (three); one disconnected provider cannot hide working sources.
    const results = await Promise.all(providers.filter(provider => !selected || provider.id === selected).map(async provider => {
      if (!provider.transport) return { status: { provider: provider.id, status: "not_connected", toolCount: 0, reason: provider.reason ?? "PROVIDER_NOT_CONFIGURED" } as ProviderStatus, tools: [] };
      try {
        const registry = await provider.transport.listTools();
        rejectCredentials(registry);
        if (registry.length > 1000 || new Set(registry.map(tool => tool.name)).size !== registry.length) throw new Error("INVALID_REGISTRY");
        const entries = registry.map(tool => {
          if (!/^[A-Za-z0-9_.-]{1,100}$/.test(tool.name) || !tool.inputSchema || tool.inputSchema.type !== "object") throw new Error("INVALID_REGISTRY");
          const readOnly = provider.isReadOnly(tool);
          return { ...tool, name: runtimeName(provider.id, tool.name), provider: provider.id, remoteName: tool.name,
            permission: readOnly && provider.id === "erp" ? "read" : "approval_required", availability: readOnly ? "available" : "blocked" } as RuntimeTool;
        });
        return { status: { provider: provider.id, status: "connected", toolCount: entries.length } as ProviderStatus, tools: entries };
      } catch { return { status: { provider: provider.id, status: "unavailable", toolCount: 0, reason: "REGISTRY_UNAVAILABLE_OR_ACCESS_DENIED" } as ProviderStatus, tools: [] }; }
    }));
    for (const result of results) { statuses.push(result.status); tools.push(...result.tools); }
    return { tools, providers: statuses, discoveredAt: new Date().toISOString() };
  }
  async function call(name: string, args: ObjectJson, signal: AbortSignal, expectedSchema?: ObjectJson): Promise<Json> {
    const selected = skillNames.has(name) ? "skills" : providers.find(provider => name.startsWith(`${provider.id}__`))?.id;
    if (!selected) throw new RuntimeToolError("RUNTIME_TOOL_UNAVAILABLE_OR_FORBIDDEN");
    const { tools } = await discover(selected); // Recheck permissions and current schema immediately before dispatch.
    const tool = tools.find(tool => tool.name === name);
    if (!tool || tool.availability !== "available") throw new RuntimeToolError("RUNTIME_TOOL_UNAVAILABLE_OR_FORBIDDEN");
    if (expectedSchema && stableJson(tool.inputSchema) !== stableJson(expectedSchema)) throw new RuntimeToolError("APPROVED_SCHEMA_CHANGED");
    rejectCredentials(args);
    try { validate(tool.inputSchema, args); }
    catch (error) {
      throw new RuntimeToolError(error instanceof Error && /SCHEMA_.*UNSUPPORTED/.test(error.message) ? "UNSUPPORTED_TOOL_SCHEMA" : "INVALID_TOOL_ARGUMENTS");
    }
    let result: Json;
    if (tool.provider === "skills") {
      const response = await runCatalogTool(name, args);
      result = response.body as unknown as Json;
    } else {
      const provider = providers.find(provider => provider.id === tool.provider)!;
      result = await provider.transport!.callTool(tool.remoteName, args, signal, tool.inputSchema);
    }
    rejectCredentials(result);
    return result;
  }
  const transport: Transport = { async listTools() { return (await discover()).tools.filter(tool => tool.availability === "available"); }, callTool: call };
  return { discover, call, transport };
}
export type RuntimeTools = ReturnType<typeof createRuntimeTools>;
