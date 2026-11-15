import assert from "node:assert/strict";
import test from "node:test";

import { buildAdvisorBrief, defaultConstraintPolicy, evaluateAdsInventoryConstraint, resolveCurrentAcos } from "@/lib/ads-inventory/constraint";

const baseLead = { productionDays: 30, domesticDays: 5, oceanDays: 25, safetyDays: 7 };

function evaluate(overrides: {
  available?: number;
  p50Daily?: number;
  p90Daily?: number | null;
  agingDays?: number | null;
  snapshotAgeHours?: number | null;
  spend?: number;
  sales?: number;
  acosPct?: number | null;
  grossMarginPct?: number | null;
  unitPrice?: number | null;
  policy?: Record<string, number>;
} = {}) {
  return evaluateAdsInventoryConstraint({
    sku: "SKU-1",
    asOf: "2026-11-14",
    ads: {
      spend: overrides.spend ?? 200,
      sales: overrides.sales ?? 1400,
      orders: 20,
      acosPct: overrides.acosPct === undefined ? null : overrides.acosPct,
      windowDays: 7,
    },
    inventory: {
      available: overrides.available ?? 400,
      inboundConfirmed: 0,
      agingDays: overrides.agingDays === undefined ? 40 : overrides.agingDays,
      snapshotAgeHours: overrides.snapshotAgeHours === undefined ? 2 : overrides.snapshotAgeHours,
      snapshotId: "snapshot-2026-11-14",
    },
    economics: {
      unitPrice: overrides.unitPrice === undefined ? 20 : overrides.unitPrice,
      unitCost: 14,
      grossMarginPct: overrides.grossMarginPct === undefined ? 30 : overrides.grossMarginPct,
      targetNetMarginPct: 8,
      currency: "USD",
    },
    demand: { p50Daily: overrides.p50Daily ?? 10, p90Daily: overrides.p90Daily === undefined ? 13 : overrides.p90Daily, source: "forecast-v1 HOLT_LINEAR" },
    lead: baseLead,
    policy: overrides.policy,
  });
}

test("short cover blocks any spend increase and names the stockout date", () => {
  const result = evaluate({ available: 100, p50Daily: 10 });
  assert.equal(result.decision, "BLOCK_BOOST");
  assert.equal(result.maxAdditionalDailySpend, 0);
  assert.equal(result.requiredCoverDays, 67);
  assert.equal(result.daysOfCoverP50, 10);
  assert.equal(result.stockoutDateP50, "2026-11-24");
  assert.ok(result.forbiddenActions.includes("加投"));
  assert.ok(result.allowedActions.some((row) => row.includes("降低竞价")));
});

test("slow-moving stock with excess cover opens a bounded clearance budget", () => {
  const result = evaluate({ available: 1000, p50Daily: 10, agingDays: 120 });
  assert.equal(result.decision, "ALLOW_CLEARANCE");
  assert.ok(result.clearance);
  assert.equal(result.clearance.units, 330);
  assert.equal(result.clearance.lossTolerance, 1980);
  assert.equal(result.clearance.currency, "USD");
  // 30% of current daily spend (200/7) is stricter than the margin budget.
  assert.equal(result.currentDailySpend, 28.57);
  assert.equal(result.maxAdditionalDailySpend, 8.57);
  assert.ok(result.reasons.some((row) => row.includes("滞销")));
});

test("ACOS above the margin ceiling forces cost reduction before any boost", () => {
  const result = evaluate({ available: 700, p50Daily: 10, agingDays: 30, acosPct: 40 });
  assert.equal(result.decision, "OPTIMIZE_ACOS");
  assert.equal(result.targetAcosPct, 22);
  assert.equal(result.currentAcosPct, 40);
  assert.equal(result.maxAdditionalDailySpend, 0);
  assert.ok(result.forbiddenActions.includes("加投"));
});

test("healthy stock with ACOS under the ceiling stays on hold with a capped increase", () => {
  const result = evaluate({ available: 700, p50Daily: 10, agingDays: 30, acosPct: 15 });
  assert.equal(result.decision, "HOLD");
  assert.equal(result.maxAdditionalDailySpend, 8.57);
  assert.deepEqual(result.forbiddenActions, []);
});

test("stale inventory snapshots block the decision entirely", () => {
  const result = evaluate({ snapshotAgeHours: 48 });
  assert.equal(result.decision, "NEEDS_DATA");
  assert.ok(result.missingInputs.some((row) => row.includes("新鲜库存快照")));
  assert.equal(result.maxAdditionalDailySpend, null);
});

test("missing gross margin or zero demand never becomes an optimistic hold", () => {
  assert.equal(evaluate({ grossMarginPct: null }).decision, "NEEDS_DATA");
  assert.equal(evaluate({ p50Daily: 0 }).decision, "NEEDS_DATA");
  const missingLead = evaluateAdsInventoryConstraint({
    sku: "SKU-2",
    asOf: "2026-11-14",
    ads: { spend: 200, sales: 1400, orders: 20, acosPct: null, windowDays: 7 },
    inventory: { available: 400, inboundConfirmed: 0, agingDays: 30, snapshotAgeHours: 1, snapshotId: "s" },
    economics: { unitPrice: 20, unitCost: 14, grossMarginPct: 30, targetNetMarginPct: 8, currency: "USD" },
    demand: { p50Daily: 10, p90Daily: 13, source: "forecast" },
    lead: { productionDays: null, domesticDays: 5, oceanDays: 25, safetyDays: 7 },
  });
  assert.equal(missingLead.decision, "NEEDS_DATA");
  assert.ok(missingLead.missingInputs.some((row) => row.includes("制造" ) || row.includes("生产")));
});

test("ACOS is derived from spend and sales when not supplied", () => {
  assert.equal(resolveCurrentAcos({ spend: 200, sales: 1000, orders: 10, acosPct: null, windowDays: 7 }), 20);
  assert.equal(resolveCurrentAcos({ spend: 200, sales: 0, orders: 0, acosPct: null, windowDays: 7 }), null);
  assert.equal(resolveCurrentAcos({ spend: null, sales: null, orders: null, acosPct: 12.5, windowDays: 7 }), 12.5);
});

test("advisor brief carries facts and evidence but no execution amounts the model could emit", () => {
  const result = evaluate({ available: 1000, p50Daily: 10, agingDays: 120 });
  const brief = buildAdvisorBrief(result, { sku: "SKU-1", asOf: "2026-11-14" });
  assert.equal(brief.decision, "ALLOW_CLEARANCE");
  assert.equal(brief.evidence.snapshotId, "snapshot-2026-11-14");
  assert.equal("maxAdditionalDailySpend" in brief, false, "预算属于执行层，模型不得生成");
  assert.equal("suggestedQuantity" in brief, false);
  assert.ok(brief.forbiddenActions.length > 0);
});

test("default policy values are explicit and reviewable", () => {
  assert.equal(defaultConstraintPolicy.targetTurnoverDays, 45);
  assert.equal(defaultConstraintPolicy.staleSnapshotHours, 36);
  assert.equal(defaultConstraintPolicy.maxDailySpendIncreasePct, 30);
});
