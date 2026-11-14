import assert from "node:assert/strict";
import test from "node:test";

import { adsMetricsFromRows, buildConstraintFromReplenishmentPlan, failClosedConstraint, readReplenishmentPlanFacts } from "@/lib/ads-inventory/from-replenishment";
import { gatePpcReportWithInventory } from "@/lib/agent-platform/ppc-inventory-gate";
import type { PpcAnalysisReport } from "@/lib/agent-platform/ppc";
import { calculateReplenishment, parseReplenishmentInputs } from "@/lib/operations/replenishment";

const TODAY = "2026-11-14";

function plan(available: number, aging?: { agingDays: number }) {
  const inputs = parseReplenishmentInputs({
    lifecycle: "MATURE",
    matureDemandModel: "COMPLETE_28_DAY",
    productionDays: 30,
    domesticDays: 5,
    oceanDays: 25,
    safetyDays: 7,
    reviewDays: 30,
    salesHistory: [],
    seasonality: null,
    demandForecast: { p50Daily: 10, p90Daily: 13, method: "holt-winters", confidence: "MEDIUM", asOf: TODAY },
    receipts: [],
    unitProfit: 6,
    currency: "USD",
    acos: 18,
    advertisingWindow: "last 7 days",
    sourceNote: "测试：补货计划到广告门禁的联动",
  });
  const result = calculateReplenishment(inputs, { available, inbound: 0, fresh: true }, TODAY);
  return {
    generatedAt: new Date("2026-11-14T02:00:00.000Z"),
    result: { ...result, inventorySource: "sellfox_inventory_current" },
    inputSnapshot: {
      inputs,
      inventory: { available, inbound: 0, freshness: "FRESH", capturedAt: "2026-11-14T01:00:00.000Z" },
      inventorySource: "sellfox_inventory_current",
      aging: aging
        ? {
            agingDays: aging.agingDays,
            weightedAgeDays: aging.agingDays,
            snapshotId: "wmsAging:snap-1",
            snapshotDate: TODAY,
            capturedAt: "2026-11-14T01:00:00.000Z",
            dataStatus: "COMPLETE",
            warehouses: 1,
            note: `WMS 库龄（1 个仓合并）：最老档下界 ${aging.agingDays} 天。`,
          }
        : null,
      asOf: TODAY,
    },
  };
}

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
        currentBid: 1.2, suggestedBid: 1.5, deltaPercent: 25, recommendation: "提高竞价",
        confidence: 0.8, evidence: [],
      },
      {
        rowId: "r2", campaignGroupId: "g1", keyword: "cheap earbuds", target: "cheap earbuds",
        currentBid: 1.1, suggestedBid: 0.9, deltaPercent: -18, recommendation: "降低竞价",
        confidence: 0.7, evidence: [],
      },
    ],
    negativeRecommendations: [],
    campaignRecommendations: [],
    actionPlan: [],
    evidence: [],
    recommendation: "demo",
    generatedAt: "2026-11-14T00:00:00.000Z",
  };
}

const ads = { spend: 200, sales: 1400, orders: 20, acosPct: null, windowDays: 7 };

test("plan facts are read from the published snapshot, never recomputed", () => {
  const facts = readReplenishmentPlanFacts(plan(400));
  assert.equal(facts.p50Daily, 10);
  assert.equal(facts.p90Daily, 13);
  assert.equal(facts.demandSource, "FORECAST");
  assert.equal(facts.available, 400);
  assert.equal(facts.lead.productionDays, 30);
  assert.equal(facts.lead.safetyDays, 7);
  assert.equal(facts.currency, "USD");
  assert.equal(facts.inventoryCapturedAt, "2026-11-14T01:00:00.000Z");
});

test("thin stock from the plan blocks bid increases end to end", () => {
  const constraint = buildConstraintFromReplenishmentPlan({
    sku: "SKU-1", asOf: TODAY, now: new Date("2026-11-14T03:00:00.000Z"), plan: plan(400), ads,
    economics: { unitPrice: 22, unitCost: 15.4, grossMarginPct: 30 },
  });
  assert.equal(constraint.decision, "BLOCK_BOOST");
  assert.equal(constraint.daysOfCoverP50, 40);
  assert.equal(constraint.requiredCoverDays, 67);

  const gated = gatePpcReportWithInventory(report(), constraint);
  assert.equal(gated.gate.removedBidIncreases, 1);
  assert.equal(gated.report.bidRecommendations.length, 1);
  assert.match(gated.blocked[0].reason, /加投/);
});

test("ample stock plus acceptable ACOS keeps the report unchanged", () => {
  const constraint = buildConstraintFromReplenishmentPlan({
    sku: "SKU-1", asOf: TODAY, now: new Date("2026-11-14T03:00:00.000Z"), plan: plan(2000), ads,
    economics: { unitPrice: 22, unitCost: 15.4, grossMarginPct: 30 },
  });
  assert.equal(constraint.decision, "HOLD");
  const gated = gatePpcReportWithInventory(report(), constraint);
  assert.equal(gated.gate.removedBidIncreases, 0);
  assert.equal(gated.report.bidRecommendations.length, 2);
});

test("a missing gross margin degrades to NEEDS_DATA and still blocks increases", () => {
  const constraint = buildConstraintFromReplenishmentPlan({
    sku: "SKU-1", asOf: TODAY, now: new Date("2026-11-14T03:00:00.000Z"), plan: plan(2000), ads,
    economics: { unitPrice: null, unitCost: null, grossMarginPct: null },
  });
  assert.equal(constraint.decision, "NEEDS_DATA");
  assert.ok(constraint.missingInputs.some((item) => item.includes("毛利率")));
  const gated = gatePpcReportWithInventory(report(), constraint);
  assert.equal(gated.gate.removedBidIncreases, 1);
  assert.equal(gated.gate.keptBidDecreases, 1);
});

test("WMS aging from the plan opens the clearance branch", () => {
  const constraint = buildConstraintFromReplenishmentPlan({
    sku: "SKU-1", asOf: TODAY, now: new Date("2026-11-14T03:00:00.000Z"), plan: plan(2000, { agingDays: 150 }), ads,
    economics: { unitPrice: 22, unitCost: 15.4, grossMarginPct: 30 },
  });
  assert.equal(constraint.decision, "ALLOW_CLEARANCE");
  // Excess is measured against max(target turnover 45, required cover 67): 2000 - 10*67
  assert.equal(constraint.clearance?.units, 1330);
  assert.ok((constraint.clearance?.lossTolerance ?? 0) > 0);
  assert.ok(constraint.reasons.some((item) => item.includes("库龄")));
  const gated = gatePpcReportWithInventory(report(), constraint);
  assert.equal(gated.gate.removedBidIncreases, 0);
  assert.equal(gated.report.bidRecommendations.length, 2);
});

test("without aging the same stock stays HOLD and says why", () => {
  const constraint = buildConstraintFromReplenishmentPlan({
    sku: "SKU-1", asOf: TODAY, now: new Date("2026-11-14T03:00:00.000Z"), plan: plan(2000), ads,
    economics: { unitPrice: 22, unitCost: 15.4, grossMarginPct: 30 },
  });
  assert.equal(constraint.decision, "HOLD");
  assert.equal(constraint.clearance, null);
  assert.ok(constraint.reasons.some((item) => item.includes("无 WMS 库龄快照")));
});

test("a stale inventory snapshot is rejected rather than used", () => {
  const stale = plan(2000);
  stale.inputSnapshot.inventory.capturedAt = "2026-11-10T01:00:00.000Z";
  const constraint = buildConstraintFromReplenishmentPlan({
    sku: "SKU-1", asOf: TODAY, now: new Date("2026-11-14T03:00:00.000Z"), plan: stale, ads,
    economics: { unitPrice: 22, unitCost: 15.4, grossMarginPct: 30 },
  });
  assert.equal(constraint.decision, "NEEDS_DATA");
  assert.ok(constraint.missingInputs.some((item) => item.includes("新鲜库存快照")));
});

test("no replenishment plan means no inventory facts, not optimistic defaults", () => {
  const constraint = buildConstraintFromReplenishmentPlan({
    sku: "SKU-1", asOf: TODAY, now: new Date("2026-11-14T03:00:00.000Z"), plan: null, ads,
    economics: { unitPrice: 22, unitCost: 15.4, grossMarginPct: 30 },
  });
  assert.equal(constraint.decision, "NEEDS_DATA");
  assert.ok(constraint.reasons.some((item) => item.includes("没有补货计划")));
  assert.equal(constraint.daysOfCoverP50, null);
});

test("ads metrics derive ACOS from the rows that were actually loaded", () => {
  const metrics = adsMetricsFromRows({
    rows: [
      { spend: 100, sales: 500, orders: 10 },
      { spend: 100, sales: 500, orders: 10 },
    ],
    windowDays: 7,
  });
  assert.equal(metrics.spend, 200);
  assert.equal(metrics.sales, 1000);
  assert.equal(metrics.acosPct, 20);
  assert.equal(metrics.windowDays, 7);
  assert.equal(adsMetricsFromRows({ rows: [], windowDays: null }).spend, null);
});

test("a gate that cannot compute fails closed and blocks every increase", () => {
  const constraint = failClosedConstraint("库存门禁计算失败（relation missing）");
  assert.equal(constraint.decision, "NEEDS_DATA");
  const gated = gatePpcReportWithInventory(report(), constraint);
  assert.equal(gated.gate.removedBidIncreases, 1);
  assert.equal(gated.gate.keptBidDecreases, 1);
  assert.equal(gated.report.bidRecommendations.length, 1);
  assert.match(gated.gate.reasons.join(" "), /计算失败/);
});
