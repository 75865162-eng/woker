import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { adsCapabilityBlockers, listAdsCapabilities } from "../src/lib/amazon-ads/capabilities";

test("SP Product Ad structure coverage does not imply SB or SD support", () => {
  const all = listAdsCapabilities();
  const sp = listAdsCapabilities("SP");
  assert.equal(all.filter(row => row.read === "STRUCTURE_WORKER").length, 9);
  assert.ok(all.filter(row => row.product !== "SP" && row.domain !== "profiles").every(row => row.read === "NOT_IMPLEMENTED" && row.mcpTool === null));
  assert.equal(sp.find(row => row.domain === "product-ads")?.read, "STRUCTURE_WORKER");
  const campaignNegative = sp.find(row => row.domain === "campaign-negative-keywords")!;
  const groupNegative = sp.find(row => row.domain === "negative-keywords")!;
  assert.notEqual(campaignNegative.entityType, groupNegative.entityType);
  assert.notDeepEqual(campaignNegative.endpoints, groupNegative.endpoints);
});

test("SP 五类绩效报表都有实盘适配器，但仍不声称真实账号已验收", () => {
  const rows = listAdsCapabilities("SP").filter(row => row.mcpTool === "amazon.ads.reports.list");
  assert.equal(rows.length, 5);
  const expected: Record<string, string> = {
    "campaign-performance": "spCampaigns",
    "advertised-product-performance": "spAdvertisedProduct",
    "search-term-performance": "spSearchTerm",
    "placement-performance": "spCampaigns",
    "targeting-performance": "spTargeting",
  };
  for (const row of rows) {
    assert.equal(row.read, "REPORT_WORKER");
    assert.equal(row.acquisition, "FORMAL_LIVE_ADAPTER");
    assert.equal(row.contract, "DOCUMENTED_REPORT_TYPE");
    assert.equal(row.apiVersion, "Reporting v3");
    assert.equal(row.entityType, expected[row.domain]);
    assert.equal(row.endpoints.length, 2);
    assert.ok(adsCapabilityBlockers(row).includes("LIVE_ACCEPTANCE_NOT_VERIFIED"));
    assert.ok(adsCapabilityBlockers(row).includes("PROFILE_PERMISSION_REQUIRES_CHECK"));
    assert.ok(!adsCapabilityBlockers(row).includes("READ_ADAPTER_NOT_IMPLEMENTED"));
    assert.ok(!adsCapabilityBlockers(row).includes("ISOLATED_FIXTURE_ONLY"));
  }
  // SP 没有独立位置报表类型，官方做法是 spCampaigns + campaignPlacement。
  assert.equal(rows.find(row => row.domain === "placement-performance")?.entityType, "spCampaigns");
});

test("code catalog cannot authorize live access, writes or invent history limits", () => {
  const rows = listAdsCapabilities();
  assert.equal(new Set(rows.map(row => `${row.product}:${row.domain}`)).size, rows.length);
  for (const row of rows) {
    assert.equal(row.historyLimitDays, null);
    assert.equal(row.write, "NOT_IMPLEMENTED");
    assert.ok(["NONE", "ISOLATED_FIXTURE_ONLY", "FORMAL_LIVE_ADAPTER"].includes(row.acquisition));
    assert.ok(adsCapabilityBlockers(row).includes("LIVE_ACCEPTANCE_NOT_VERIFIED"));
    assert.ok(adsCapabilityBlockers(row).includes("PROFILE_PERMISSION_REQUIRES_CHECK"));
  }
  // Callers receive independent arrays; an inventory consumer cannot mutate a global readiness cache.
  const row = rows.find(row => row.domain === "campaigns" && row.product === "SP")!;
  (row.endpoints as string[]).length = 0;
  assert.equal(listAdsCapabilities("SP").find(row => row.domain === "campaigns")?.endpoints.length, 1);
});

test("capability CLI preserves JSON inventory and exposes isolation in Markdown without live readiness", () => {
  const run = (...args: string[]) => execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/amazon-ads-capabilities.ts", ...args], { encoding: "utf8", env: { ...process.env, NODE_ENV: "test" }, timeout: 10000 });
  const output = JSON.parse(run("--product=SP")) as { kind: string; capabilities: ReturnType<typeof listAdsCapabilities> };
  assert.equal(output.kind, "CODE_INVENTORY_ONLY");
  assert.equal(output.capabilities.length, 18);
  const row = output.capabilities.find(value => value.domain === "campaign-performance")!;
  assert.equal(row.read, "REPORT_WORKER");
  assert.equal(row.acquisition, "FORMAL_LIVE_ADAPTER");
  assert.equal(row.liveAcceptance, "NOT_VERIFIED");
  const markdown = run("--product=SP", "--markdown");
  assert.match(markdown, /Read \| Acquisition \| Contract/);
  assert.match(markdown, /campaign-performance \| REPORT_WORKER \| FORMAL_LIVE_ADAPTER/);
  assert.match(markdown, /NOT a live readiness or authorization decision/);
});
