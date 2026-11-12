import assert from "node:assert/strict";
import test from "node:test";
import { automaticAdapters, automaticAdapter, assertAutomaticAdapterPolicy } from "@/lib/amazon-sync/automatic-adapters";
import { automaticBackfillStart } from "@/lib/amazon-sync/automatic-schedule";
import { reportingMarketplaceIds, reportTimeZone } from "@/lib/amazon-sync/date-range";

test("registered policy matrix preserves account/site isolation across calendar boundaries", t => {
  const dates = ["2024-02-29T12:00:00Z", "2026-01-01T00:30:00Z", "2026-03-08T09:30:00Z",
    "2026-04-01T00:30:00Z", "2026-11-01T08:30:00Z", "2026-12-31T23:30:00Z"];
  let cases = 0, policiesValidated = 0;
  for (const date of dates) for (const marketplaceId of reportingMarketplaceIds) for (const account of ["fixture-account-a", "fixture-account-b"]) {
    const now = new Date(date), applicationId = `fixture-app-${account}`;
    const context = { now, initialFrom: automaticBackfillStart(now), applicationId, marketplaceId,
      marketplaceTimeZone: reportTimeZone(marketplaceId), catalogSourceId: `${account}-${marketplaceId}` };
    for (const definition of automaticAdapters) {
      const adapter = automaticAdapter(definition.resource)!;
      const policies = adapter.discoveryScope === "seller"
        ? adapter.createSellerPolicy?.({ ...context, marketplaces: [{ marketplaceId, marketplaceTimeZone: context.marketplaceTimeZone }] }) ?? {}
        : adapter.createMarketplacePolicy?.(context) ?? {};
      const before = JSON.stringify(policies);
      assert.doesNotThrow(() => assertAutomaticAdapterPolicy(adapter, policies), `${date}/${marketplaceId}/${account}/${adapter.resource}`);
      assert.equal(JSON.stringify(policies), before, "validation cannot normalize input in place");
      if (adapter.requiredPolicy) {
        const value = policies[adapter.requiredPolicy] as { applicationId: string; marketplaceTimeZone?: string; marketplaces?: Array<{ marketplaceId: string }>; discovery?: { sourceId: string } };
        assert.equal(value.applicationId, applicationId);
        if (value.marketplaceTimeZone) assert.equal(value.marketplaceTimeZone, context.marketplaceTimeZone);
        if (value.marketplaces) assert.deepEqual(value.marketplaces.map(site => site.marketplaceId), [marketplaceId]);
        if (value.discovery) assert.equal(value.discovery.sourceId, context.catalogSourceId);
        policiesValidated++;
      }
      cases++;
    }
  }
  assert.equal(cases, dates.length * reportingMarketplaceIds.length * 2 * automaticAdapters.length);
  t.diagnostic(JSON.stringify({ adapters: automaticAdapters.length, marketplaces: reportingMarketplaceIds.length, dates: dates.length,
    accounts: 2, cases, policiesValidated, scope: "registered default policy factories; not every possible valid policy value", realAmazonRequests: 0 }));
});
