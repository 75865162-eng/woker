import type { AiModelSettings } from "@/lib/ai-settings";
import { fetchAiApi } from "@/lib/server/ai-fetch";
import { buildAiRequestHeaders, buildAiTextEndpoint, buildResponsesRequestOptions } from "@/lib/server/ai-runtime";
import type { Action, Agent } from "./types";
import { parseAction } from "./fixture";

/** Existing ERP AI transport, credentials remain exclusively in request headers. */
export function createResearchAiAgent(settings: AiModelSettings, request: typeof fetchAiApi = fetchAiApi): Agent {
  return { async next(context) {
    if (!settings.apiKey) throw new Error("RESEARCH_AI_NOT_CONFIGURED");
    // Keep full evidence persisted, but avoid repeating registry/Skill snapshots inside every AI request.
    const run = context.run;
    const prompt = JSON.stringify({ skill: context.skill, tools: context.tools, run: {
      id: run.id, requirement: run.requirement, asin: run.asin, marketplace: run.marketplace, stage: run.stage,
      requiredProviders: run.requiredProviders, selectedCandidateId: run.selectedCandidateId, results: run.results,
      calls: run.calls?.map(({ id, stage, provider, tool, arguments: args, status, rawResponse, errorCode }) => ({
        id, stage, provider, tool, arguments: args, status, errorCode,
        rawResponse: tool === "meta_load_skill" && args.skill_name === context.skill.name ? { note: "Exact Skill body is supplied in context.skill." } : rawResponse,
      })),
    } });
    if (prompt.length > 180_000) throw new Error("RESEARCH_CONTEXT_TOO_LARGE_REQUIRES_REVIEW");
    const chat = settings.wireApi === "chat_completions";
    const response = await request(buildAiTextEndpoint(settings), {
      method: "POST", signal: AbortSignal.timeout(25_000), headers: buildAiRequestHeaders(settings),
      body: JSON.stringify(chat ? { model: settings.model, messages: [{ role: "system", content: context.instructions }, { role: "user", content: prompt }], response_format: { type: "json_object" } }
        : { ...buildResponsesRequestOptions(settings), model: settings.model, instructions: context.instructions, input: prompt, text: { format: { type: "json_object" } } }),
    });
    if (!response.ok) throw new Error("RESEARCH_AI_REQUEST_FAILED");
    const value = await response.json() as { choices?: { message?: { content?: string } }[]; output_text?: string; output?: { content?: { text?: string }[] }[] };
    const text = chat ? value.choices?.[0]?.message?.content : value.output_text ?? value.output?.flatMap((part) => part.content ?? []).map((part) => part.text ?? "").join("\n");
    if (!text || text.includes(settings.apiKey)) throw new Error("UNSAFE_OR_EMPTY_AI_RESPONSE");
    return parseAction(text) as unknown as Action;
  } };
}
