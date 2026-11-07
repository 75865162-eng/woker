import assert from "node:assert/strict";
import { test } from "node:test";
import { assertReportScopeDigest, reportScopeDigest } from "../src/lib/amazon-ads/report-scope";

test("frozen report identity detects equal-revision rebindings and contract drift", () => {
  const task = { id: "task", organizationId: "org", workspaceId: "workspace", requestedByUserId: "actor", planId: "plan", planRevision: 1, profileId: "internal", requestedFrom: new Date("2026-11-01"), requestedTo: new Date("2026-11-02") };
  const profile = { id: "internal", authorizationId: "auth-a", profileId: "999", region: "NA", sellerAccountId: "seller", marketplaceId: "site", currencyCode: "USD", timezone: "America/Los_Angeles" };
  const manifest = { reportType: "spCampaigns", apiVersion: "reporting-v3", dimensions: ["campaignId"] };
  const digest = reportScopeDigest(task, profile, 1, manifest);
  assertReportScopeDigest(digest, reportScopeDigest(task, profile, 1, { dimensions: ["campaignId"], apiVersion: "reporting-v3", reportType: "spCampaigns" }));
  for (const field of ["authorizationId", "profileId", "region", "sellerAccountId", "marketplaceId", "currencyCode", "timezone"] as const) {
    assert.throws(() => assertReportScopeDigest(digest, reportScopeDigest(task, { ...profile, [field]: "changed" }, 1, manifest)), /FROZEN_SCOPE/);
  }
  assert.throws(() => assertReportScopeDigest(digest, reportScopeDigest(task, profile, 2, manifest)), /FROZEN_SCOPE/);
  assert.throws(() => assertReportScopeDigest(digest, reportScopeDigest({ ...task, requestedTo: new Date("2026-11-03") }, profile, 1, manifest)), /FROZEN_SCOPE/);
  assert.throws(() => assertReportScopeDigest(digest, reportScopeDigest(task, profile, 1, { ...manifest, apiVersion: "changed" })), /FROZEN_SCOPE/);
  assert.throws(() => assertReportScopeDigest(undefined, digest), /FROZEN_SCOPE/);
});
