import { createHash } from "node:crypto";
import type { Run } from "./types";

/** Saved evidence only. Never dispatches a provider request or changes billing state. */
export function readResearchEvidence(run: Run, query: URLSearchParams) {
 const integer = (name: string, fallback: number, max: number) => {
  const value = query.get(name);
  if (value !== null && !/^[0-9]+$/.test(value)) throw new Error("INVALID_RESEARCH_REQUEST");
  const number = value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < (name === "offset" ? 0 : 1) || number > max) throw new Error("INVALID_RESEARCH_REQUEST");
  return number;
 };
 const callId = query.get("callId");
 if (callId !== null) {
  const call = run.calls.find(c => c.id === callId);
  if (!call) throw new Error("RESEARCH_EVIDENCE_NOT_FOUND");
  const offset = integer("offset", 0, 16_000_000), length = integer("length", 16000, 32000);
  const text = JSON.stringify(call.rawResponse ?? null);
  if (offset > text.length) throw new Error("INVALID_RESEARCH_REQUEST");
  const chunk = text.slice(offset, offset + length);
  return { runId: run.id, persisted: true, callId: call.id, tool: call.tool, status: call.status,
   evidenceAvailable: call.rawResponse !== undefined, encoding: "json-utf16-code-units",
   sha256: createHash("sha256").update(text, "utf8").digest("hex"), offset, totalLength: text.length,
   chunk, nextOffset: offset + chunk.length < text.length ? offset + chunk.length : null };
 }
 const page = integer("page", 1, 10000), pageSize = integer("pageSize", 20, 50);
 const calls = run.calls.slice((page - 1) * pageSize, page * pageSize).map(call => ({
  id: call.id, stage: call.stage, skill: call.skill, provider: call.provider, tool: call.tool,
  requestedAt: call.requestedAt, respondedAt: call.respondedAt, status: call.status,
  dispatch: call.dispatch, paid: call.paid, billing: call.billing, billingUnit: call.billingUnit,
  knownUnits: call.knownUnits, evidenceAvailable: call.rawResponse !== undefined,
 }));
 return { runId: run.id, persisted: true, page, pageSize, total: run.calls.length, hasNext: page * pageSize < run.calls.length, calls };
}
