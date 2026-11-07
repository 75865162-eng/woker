import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveAdsMetrics } from "@/lib/amazon-ads/metrics";

test("Ads derived metrics use source values and stay null for unavailable denominators", () => {
  assert.deepEqual(deriveAdsMetrics({ impressions: "200", clicks: "20", spend: "10", orders: "4", sales: "50" }), {
    ctr: "10", cpc: "0.5", cvr: "20", acos: "20", roas: "5",
  });
  assert.deepEqual(deriveAdsMetrics({ impressions: "0", clicks: "0", spend: "0", orders: null, sales: null }), {
    ctr: null, cpc: null, cvr: null, acos: null, roas: null,
  });
});
