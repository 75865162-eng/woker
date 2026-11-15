import assert from "node:assert/strict";
import test from "node:test";

import { gatePpcReportWithInventory, ungatedPpcReport } from "@/lib/agent-platform/ppc-inventory-gate";
import type { PpcAnalysisReport } from "@/lib/agent-platform/ppc";
import { evaluateAdsInventoryConstraint } from "@/lib/ads-inventory/constraint";

function report(): PpcAnalysisReport {
  return {
    goal: "降 ACOS",
    marketplace: "US",
    scope: { campaignGroupIds: ["g1"], campaignGroupNames: ["Group 1"] },
    summary: "demo",
    diagnosis: [],
    opportunities: [],
    bidRecommendations: [
      {
        rowId: "r1", campaignGroupId: "g1", keyword: "wireless earbuds", target: "wireless earbuds",
        currentBid: 1.2, suggestedBid: 1.5, deltaPercent: 25, recommendation: "提高竞价抢占曝光",
        confidence: 0.8, evidence: [],
      },
      {
        rowId: "r2", campaignGroupId: "g1", keyword: "cheap earbuds", target: "cheap earbuds",
        currentBid: 1.1, suggestedBid: 0.9, deltaPercent: -18, recommendation: "降低竞价控 ACOS",
        confidence: 0.7, evidence: [],
      },
    ],
    negativeRecommendations: [],
    campaignRecommendations: [],
    actionPlan: ["先处理高 ACOS 词"],
    evidence: [],
    recommendation: "demo",
    generatedAt: "2026-11-14T00:00:00.000Z",
  };
}

function constraint(overrides: { available?: number; p50Daily?: number; agingDays?: number; acosPct?: number } = {}) {
  return evaluateAdsInventoryConstraint({
    sku: "SKU-1",
    asOf: "2026-11-14",
    ads: {
      spend: 200, sales: overrides.acosPct === undefined ? 1400 : 400, orders: 20,
      acosPct: overrides.acosPct ?? null, windowDays: 7,
    },
    inventory: {
      available: overrides.available ?? 400, inboundConfirmed: 0,
      agingDays: overrides.agingDays ?? 30, snapshotAgeHours: 2, snapshotId: "snapshot-1",
    },
    economics: { unitPrice: 22, unitCost: 15.4, grossMarginPct: 30, targetNetMarginPct: 8, currency: "USD" },
    demand: { p50Daily: overrides.p50Daily ?? 10, p90Daily: 13, source: "forecast-v1" },
    lead: { productionDays: 30, domesticDays: 5, oceanDays: 25, safetyDays: 7 },
  });
}

test("stockout risk removes bid increases but keeps bid decreases", () => {
  const gated = gatePpcReportWithInventory(report(), constraint({ available: 100 }));
  assert.equal(gated.gate.decision, "BLOCK_BOOST");
  assert.equal(gated.gate.removedBidIncreases, 1);
  assert.equal(gated.gate.keptBidDecreases, 1);
  assert.equal(gated.report.bidRecommendations.length, 1);
  assert.equal(gated.report.bidRecommendations[0].rowId, "r2");
  assert.equal(gated.blocked[0].rowId, "r1");
  assert.ok(gated.blocked[0].reason.includes("加速断货"));
  assert.ok(gated.report.actionPlan.some((row) => row.includes("拦截 1 条加投")));
});

test("clearance allows increases and carries a spend ceiling", () => {
  const gated = gatePpcReportWithInventory(report(), constraint({ available: 6000, agingDays: 150 }));
  assert.equal(gated.gate.decision, "ALLOW_CLEARANCE");
  assert.equal(gated.gate.removedBidIncreases, 0);
  assert.equal(gated.report.bidRecommendations.length, 2);
  assert.ok((gated.gate.maxAdditionalDailySpend ?? 0) > 0);
  assert.ok(gated.gate.clearanceUnits !== null && gated.gate.clearanceUnits > 0);
  assert.ok(gated.report.actionPlan.some((row) => row.includes("允许清仓加投")));
});

test("high ACOS blocks increases and names the ceiling", () => {
  const gated = gatePpcReportWithInventory(report(), constraint({ available: 5000, acosPct: 50 }));
  assert.equal(gated.gate.decision, "OPTIMIZE_ACOS");
  assert.equal(gated.gate.removedBidIncreases, 1);
  assert.ok(gated.blocked[0].reason.includes("高于上限"));
});

test("missing inventory blocks increases rather than assuming they are safe", () => {
  const missing = evaluateAdsInventoryConstraint({
    sku: "SKU-1", asOf: "2026-11-14",
    ads: { spend: 200, sales: 1400, orders: 20, acosPct: null, windowDays: 7 },
    inventory: { available: null, inboundConfirmed: 0, agingDays: null, snapshotAgeHours: null, snapshotId: "" },
    economics: { unitPrice: 22, unitCost: 15.4, grossMarginPct: 30, targetNetMarginPct: 8, currency: "USD" },
    demand: { p50Daily: null, p90Daily: null, source: "none" },
    lead: { productionDays: 30, domesticDays: 5, oceanDays: 25, safetyDays: 7 },
  });
  const gated = gatePpcReportWithInventory(report(), missing);
  assert.equal(gated.gate.decision, "NEEDS_DATA");
  assert.equal(gated.gate.removedBidIncreases, 1);
  assert.ok(gated.blocked[0].reason.includes("未通过校验"));
});

test("ungated pass-through marks the report unverified instead of silently approving", () => {
  const gated = ungatedPpcReport(report());
  assert.equal(gated.gate.applied, false);
  assert.equal(gated.report.bidRecommendations.length, 2);
  assert.equal(gated.gate.keptBidDecreases, 1);
  assert.ok(gated.gate.reasons[0].includes("人工复核"));
});
