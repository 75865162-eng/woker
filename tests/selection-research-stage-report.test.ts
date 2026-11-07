import test from "node:test";
import assert from "node:assert/strict";
import { renderResearchStageReport, renderResearchReport } from "@/lib/selection-research/report";
import type { Run } from "@/lib/selection-research/types";

test("a niche phase report is downloadable before choice without fabricating final approval", () => {
  const run = { id: "isolated", revision: 2, mode: "fixture", status: "WAITING_FOR_USER", stage: 1, marketplace: "US", requirement: '<script>alert("x")</script>',
    skills: [{ name: "test", sha256: "test" }], registry: [], policies: {}, limits: {}, calls: [], decisions: [],
    results: [{ summary: "Isolated phase", candidates: [{ id: "a", name: "test choice" }], claims: [{ text: "Unknown demand", kind: "assumption", evidenceIds: [] }] }],
  } as unknown as Run;
  const before = JSON.stringify(run);
  const html = renderResearchStageReport(run, 1);
  assert.match(html, /待人工审阅/); assert.match(html, /test choice/); assert.match(html, /隔离样本/);
  assert.match(html, /&lt;script/); assert.doesNotMatch(html, /<script/);
  assert.throws(() => renderResearchReport(run), /BOTH_HUMAN_GATES/);
  for (const stage of [0, 2, 6, 1.5, NaN]) assert.throws(() => renderResearchStageReport(run, stage), /STAGE_REPORT_UNAVAILABLE/);
  assert.equal(JSON.stringify(run), before);
});
