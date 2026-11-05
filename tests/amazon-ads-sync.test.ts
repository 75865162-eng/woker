import assert from "node:assert/strict";
import test from "node:test";
import { adsReportWindows, adsScopeEnabled, adsSyncFailureStatus, adsSyncKey, adsSyncScopes, parseAdsCheckpoint } from "@/lib/amazon-ads/sync-policy";
import { adsReadAdapterReady, pendingAdsReadAdapter, validateAdsPage } from "@/lib/amazon-ads/sync-adapter";
import { adsClientIdHash } from "@/lib/amazon-ads/api-budget";

test("Ads automatic sync is opt-in and limited to configured organization/workspace pairs", () => {
  const env = { AMAZON_ADS_SYNC_ENABLED: "true", AMAZON_ADS_SYNC_SCOPES: '[["org-a","workspace-1"],["org-b","workspace-2"]]' };
  assert.equal(adsSyncScopes({ ...env, AMAZON_ADS_SYNC_ENABLED: "false" }).length, 0);
  assert.equal(adsSyncScopes(env).length, 2);
  assert.equal(adsSyncScopes({ ...env, AMAZON_ADS_SYNC_SCOPES: '[["org-a","workspace-1"], ["org-b"]]' }).length, 0);
  assert.equal(adsSyncScopes({ ...env, AMAZON_ADS_SYNC_SCOPES: '[["org-a","workspace-1"], ["org-a","workspace-1"]]' }).length, 1);
  assert.equal(adsScopeEnabled({ organizationId: "org-a", workspaceId: "workspace-1" }, env), true);
  assert.equal(adsScopeEnabled({ organizationId: "org-a", workspaceId: "workspace-2" }, env), false);
});

test("Ads report ranges split deterministically and enforce bounded dates", () => {
  assert.deepEqual(adsReportWindows("2026-01-30", "2026-02-02", 2), [
    { from: "2026-01-30", to: "2026-01-31" },
    { from: "2026-02-01", to: "2026-02-02" },
  ]);
  assert.throws(() => adsReportWindows("2026-02-02", "2026-01-30", 2));
  assert.throws(() => adsReportWindows("2026-01-01", "2027-01-01", 0));
});

test("Ads checkpoints validate stage, cursor and page count", () => {
  assert.deepEqual(parseAdsCheckpoint(null), { stage: 0, cursor: null, pages: 0 });
  assert.deepEqual(parseAdsCheckpoint({ stage: 2, cursor: "next", pages: 4 }), { stage: 2, cursor: "next", pages: 4 });
  assert.throws(() => parseAdsCheckpoint({ stage: 99, cursor: null, pages: 0 }));
  assert.throws(() => parseAdsCheckpoint({ stage: 0, cursor: "", pages: -1 }));
});

test("Ads adapter rejects incomplete pages and never fabricates data before its contract is implemented", () => {
  assert.equal(adsReadAdapterReady(), false);
  assert.throws(() => pendingAdsReadAdapter.assertImplemented(), { code: "ADS_READ_ADAPTER_NOT_IMPLEMENTED" });
  assert.throws(() => validateAdsPage({ entities: [], nextCursor: null, complete: false }, null));
  assert.deepEqual(validateAdsPage({ entities: [{ entityType: "SP:campaign", externalId: "123", payload: { name: "fixture" } }], nextCursor: null, complete: true }, null).entities.length, 1);
  assert.throws(() => validateAdsPage({ entities: [{ entityType: "SP:campaign", externalId: "123", payload: {} }], nextCursor: "same", complete: true }, "same"));
});

test("Ads request coordination stores a stable digest instead of the client ID", () => {
  const digest = adsClientIdHash("client-id-value");
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, "client-id-value");
  assert.equal(digest, adsClientIdHash("client-id-value"));
});

test("Ads sync idempotency key is stable for equivalent inputs", () => {
  assert.equal(adsSyncKey(["p1", "2026-11-01"]), adsSyncKey(["p1", "2026-11-01"]));
  assert.notEqual(adsSyncKey(["p1", "2026-11-01"]), adsSyncKey(["p2", "2026-11-01"]));
});

test("Ads task failures distinguish retryable faults, terminal scope errors, adapter gaps and exhaustion", () => {
  assert.equal(adsSyncFailureStatus({ adapterReady: true, retryable: true, exhausted: false }), "RETRY_WAIT");
  assert.equal(adsSyncFailureStatus({ adapterReady: true, retryable: false, exhausted: false }), "BLOCKED");
  assert.equal(adsSyncFailureStatus({ adapterReady: false, retryable: false, exhausted: false }), "WAITING_FOR_ADAPTER");
  assert.equal(adsSyncFailureStatus({ adapterReady: true, retryable: true, exhausted: true }), "FAILED");
});
