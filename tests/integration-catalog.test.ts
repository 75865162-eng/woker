import assert from "node:assert/strict";
import test from "node:test";
import { getIntegrationCatalog, getMcpDatasetCatalog } from "@/lib/integration-catalog";
import { SELLFOX_FULL_HISTORY_DAYS } from "@/lib/sellfox/window-config";

test("integration catalog aggregates all three providers", () => {
  const { resources } = getIntegrationCatalog();
  const providers = new Set(resources.map(row => row.provider));
  assert.deepEqual([...providers].sort(), ["amazon_ads", "amazon_sp_api", "sellfox"]);
  assert.ok(resources.length > 50);
});

test("catalog exposes sellfox full-history windows truthfully", () => {
  const { sellfoxWindows } = getIntegrationCatalog();
  assert.equal(sellfoxWindows.maxReportDays, SELLFOX_FULL_HISTORY_DAYS);
  assert.equal(sellfoxWindows.hourlyLookbackDays, SELLFOX_FULL_HISTORY_DAYS);
  assert.equal(sellfoxWindows.backfillDaysPerRun, 365);
  assert.equal(sellfoxWindows.maxPages, 100_000);
});

test("SB/SD reports stay not_implemented with role blockers; SP reports available-needs-role", () => {
  const { resources } = getIntegrationCatalog();
  const ads = resources.filter(row => row.provider === "amazon_ads");
  const sbSd = ads.filter(row => row.id.startsWith("sb-") || row.id.startsWith("sd-"));
  assert.ok(sbSd.length > 0);
  assert.ok(sbSd.every(row => row.availability === "not_implemented"));
  assert.ok(sbSd.every(row => row.reasons.some(reason => /NOT_IMPLEMENTED|LIVE_ACCEPTANCE|PROFILE_PERMISSION/.test(reason))));
  const spReports = ads.filter(row => row.id.startsWith("sp-") && /performance/.test(row.id));
  assert.ok(spReports.length > 0);
  assert.ok(spReports.every(row => /天|保留|快照/.test(row.window)));
});

test("SP-API order_items stays not_implemented; inventory is current snapshot only", () => {
  const { resources } = getIntegrationCatalog();
  const orderItems = resources.find(row => row.provider === "amazon_sp_api" && row.id === "order_items");
  assert.ok(orderItems);
  assert.equal(orderItems.availability, "not_implemented");
  const inventory = resources.find(row => row.provider === "amazon_sp_api" && row.id === "inventory");
  assert.ok(inventory);
  assert.match(inventory.window, /当前快照/);
  assert.match(inventory.window, /不支持历史回补/);
});

test("every resource carries id, label, window and reasons; no empty availability", () => {
  const { resources } = getIntegrationCatalog();
  for (const row of resources) {
    assert.ok(row.id && row.label && row.window);
    assert.ok(["available", "not_implemented", "needs_role", "blocked"].includes(row.availability));
    assert.ok(Array.isArray(row.reasons));
  }
});

test("MCP dataset directory exposes available flag and currency warning on money tables", () => {
  const { sellfox } = getMcpDatasetCatalog();
  assert.ok(sellfox.length > 10);
  assert.ok(sellfox.every(row => typeof row.available === "boolean" && row.available));
  assert.ok(sellfox.every(row => row.reason && row.grain));
  const moneyTables = sellfox.filter(row => ["sales", "performance", "ads_product"].includes(row.key));
  assert.ok(moneyTables.length > 0);
  assert.ok(moneyTables.every(row => row.currencyWarning && /跨币种/.test(row.currencyWarning)));
  const storeTable = sellfox.find(row => row.key === "stores");
  assert.equal(storeTable?.currencyWarning, null);
});
