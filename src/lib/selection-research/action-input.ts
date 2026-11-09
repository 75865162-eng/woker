import { rejectCredentials } from "./schema";
import type { Action } from "./types";

/** Native MCP clients can encode unconstrained JSON fields as strings. Decode once,
 * before recording or fingerprinting an action; never decode provider responses. */
export function normalizeResearchAction(value: unknown): Action {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_EXTERNAL_RESEARCH_ACTION");
  const input = value as Record<string, unknown>;
  if (!["call", "complete"].includes(String(input.type)) || Object.keys(input).some(key => !["type", "tool", "arguments", "result"].includes(key))) throw new Error("INVALID_EXTERNAL_RESEARCH_ACTION");
  const key = input.type === "call" ? "arguments" : "result";
  if (input.type === "call" && (typeof input.tool !== "string" || !input.tool.trim() || "result" in input)
    || input.type === "complete" && ("tool" in input || "arguments" in input)) throw new Error("INVALID_EXTERNAL_RESEARCH_ACTION");
  let payload = input[key];
  if (typeof payload === "string") {
    if (Buffer.byteLength(payload, "utf8") > 64_000) throw new Error("RESEARCH_ACTION_JSON_TOO_LARGE");
    try { payload = JSON.parse(payload); }
    catch { throw new Error("RESEARCH_ACTION_JSON_INVALID"); }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("RESEARCH_ACTION_OBJECT_REQUIRED");
  rejectCredentials(payload);
  return { ...input, [key]: payload } as Action;
}
