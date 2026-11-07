import type { AiModelSettings } from "@/lib/ai-settings";

export type ResearchAiSource = "workspace" | "server_runtime";
export function parseResearchAiSource(value: unknown): ResearchAiSource {
  if (value === undefined || value === "workspace") return "workspace";
  if (value === "server_runtime") return value;
  throw new Error("INVALID_RESEARCH_AI_SOURCE");
}

/** Explicit per-run selection, never an automatic cross-scope credential fallback. */
export async function selectResearchAiSettings(source: unknown, adapters: {
  authorizeRuntime(): Promise<boolean>;
  workspace(): Promise<AiModelSettings>;
  runtime(): AiModelSettings;
}) {
  if (parseResearchAiSource(source) === "workspace") return adapters.workspace();
  if (!await adapters.authorizeRuntime()) throw new Error("RESEARCH_RUNTIME_AI_PERMISSION_REQUIRED");
  return adapters.runtime();
}
