import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { adsCapabilityBlockers, listAdsCapabilities } from "../src/lib/amazon-ads/capabilities";

test("SP structure coverage does not imply Product Ad, SB or SD support", () => {
  const all = listAdsCapabilities();
  const sp = listAdsCapabilities("SP");
  assert.equal(all.filter(row => row.read === "STRUCTURE_WORKER").length, 8);
  assert.ok(all.filter(row => row.product !== "SP" && row.domain !== "profiles").every(row => row.read === "NOT_IMPLEMENTED" && row.mcpTool === null));
  assert.equal(sp.find(row => row.domain === "product-ads")?.read, "NOT_IMPLEMENTED");
  const campaignNegative = sp.find(row => row.domain === "campaign-negative-keywords")!;
  const groupNegative = sp.find(row => row.domain === "negative-keywords")!;
  assert.notEqual(campaignNegative.entityType, groupNegative.entityType);
  assert.notDeepEqual(campaignNegative.endpoints, groupNegative.endpoints);
});

test("published report queries never advertise a verified report acquisition contract", () => {
  const rows = listAdsCapabilities("SP").filter(row => row.mcpTool === "amazon.ads.reports.list");
  assert.equal(rows.length, 5);
  assert.equal(rows.find(row => row.domain === "campaign-performance")?.acquisition, "ISOLATED_FIXTURE_ONLY");
  for (const row of rows) {
    assert.equal(row.read, "NOT_IMPLEMENTED");
    assert.equal(row.contract, "UNVERIFIED");
    assert.equal(row.apiVersion, null);
    assert.deepEqual(row.endpoints, []);
    assert.ok(adsCapabilityBlockers(row).includes("DOMAIN_CONTRACT_UNVERIFIED"));
    assert.ok(adsCapabilityBlockers(row).includes("READ_ADAPTER_NOT_IMPLEMENTED"));
  }
  assert.ok(adsCapabilityBlockers(rows.find(row => row.domain === "campaign-performance")!).includes("ISOLATED_FIXTURE_ONLY"));
  assert.equal(rows.find(row => row.domain === "search-term-performance")?.acquisition, "NONE");
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
  assert.equal(row.read, "NOT_IMPLEMENTED");
  assert.equal(row.acquisition, "ISOLATED_FIXTURE_ONLY");
  assert.equal(row.liveAcceptance, "NOT_VERIFIED");
  const markdown = run("--product=SP", "--markdown");
  assert.match(markdown, /Read \| Acquisition \| Contract/);
  assert.match(markdown, /campaign-performance \| NOT_IMPLEMENTED \| ISOLATED_FIXTURE_ONLY/);
  assert.match(markdown, /NOT a live readiness or authorization decision/);
});
