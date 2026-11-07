import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readResearchEvidence } from "@/lib/selection-research/evidence";
import type { Run, CallRecord } from "@/lib/selection-research/types";
const raw = { source: "isolated fixture", body: "中文😀".repeat(100) };
const call: CallRecord = { projectId: "run-1", service: "erp", arguments: {}, requestedAt: "2026-11-07T00:00:00Z", reservedUnits: 0, retryCount: 0, inputSchema: {}, id: "call-1", stage: 1, skill: "fixture", provider: "erp", tool: "data_query", status: "SUCCEEDED", paid: false, billing: "FREE", rawResponse: raw };
const run = { id: "run-1", calls: [call, { ...call, id: "call-2", rawResponse: undefined }] } as Run;

test("saved evidence summaries are paginated and exclude raw payloads", () => {
 const page = readResearchEvidence(run, new URLSearchParams({ page: "1", pageSize: "1" }));
 assert.ok(page.calls); assert.equal(page.calls.length, 1); assert.equal(page.hasNext, true);
 assert.ok(!JSON.stringify(page).includes(raw.body));
 const second = readResearchEvidence(run, new URLSearchParams({ page: "2", pageSize: "1" }));
 assert.ok(second.calls); assert.equal(second.calls[0].evidenceAvailable, false);
});
test("Unicode raw response chunks reassemble and match full SHA-256", () => {
 let offset = 0, text = "", digest = "";
 for (;;) {
  const part = readResearchEvidence(run, new URLSearchParams({ callId: "call-1", offset: String(offset), length: "7" }));
  assert.ok(typeof part.chunk === "string" && typeof part.sha256 === "string"); text += part.chunk; digest = part.sha256;
  if (part.nextOffset === null || part.nextOffset === undefined) break;
  offset = part.nextOffset;
 }
 assert.deepEqual(JSON.parse(text), raw);
 assert.equal(createHash("sha256").update(text).digest("hex"), digest);
});
test("invalid bounds and unknown evidence fail closed", () => {
 for (const params of [{ pageSize: "51" }, { page: "0" }, { page: "1.5" }, { callId: "call-1", length: "32001" }, { callId: "call-1", offset: "16000001" }, { callId: "call-1", offset: "9000" }]) assert.throws(() => readResearchEvidence(run, new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string"))), /INVALID_RESEARCH_REQUEST/);
 assert.throws(() => readResearchEvidence(run, new URLSearchParams({ callId: "other" })), /RESEARCH_EVIDENCE_NOT_FOUND/);
});
