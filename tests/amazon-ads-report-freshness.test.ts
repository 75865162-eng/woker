import { test } from "node:test";
import assert from "node:assert/strict";
import { publishedReportFreshness, selectReportDomainState, summarizeReportFreshness, type ReportDomainState } from "../src/lib/amazon-ads/report-freshness";

const state = (reportType: string, status: string, task = status): ReportDomainState => ({ profileId: "p", reportType, status, warningCodes: [task], lastAttemptAt: new Date("2026-11-06"), lastTaskId: task });
test("specific report status overrides generic state regardless of database order", () => {
  const generic = state("", "FAILED"), exact = state("spCampaigns", "CURRENT");
  for (const states of [[generic, exact], [exact, generic]]) assert.equal(selectReportDomainState(states, "p", "spCampaigns"), exact);
  assert.equal(selectReportDomainState([generic, state("other", "RUNNING")], "p", "spCampaigns"), generic);
  assert.equal(selectReportDomainState([exact], "other", "spCampaigns"), undefined);
});
test("multi-report status is deterministic, conservative, and keeps matching task evidence", () => {
  const failed = state("searchTerms", "FAILED", "failure-task"), active = state("spCampaigns", "RUNNING");
  for (const states of [[failed, active], [active, failed]]) assert.equal(selectReportDomainState(states, "p"), failed);
  assert.equal(selectReportDomainState([state("b", "CURRENT"), state("a", "CURRENT")], "p")?.reportType, "a");
});
test("report observations cannot become CURRENT from a structure schedule and failures survive empty results", () => {
  assert.equal(publishedReportFreshness(true, "CURRENT"), "OBSERVED_PUBLISHED");
  assert.equal(publishedReportFreshness(true), "OBSERVED_PUBLISHED");
  assert.equal(publishedReportFreshness(true, "STALE"), "STALE");
  assert.equal(publishedReportFreshness(false, "FAILED"), "FAILED");
  assert.equal(publishedReportFreshness(false, "RUNNING"), "SYNCING");
  assert.equal(publishedReportFreshness(false, "CURRENT"), "MISSING");
  assert.equal(summarizeReportFreshness(["MISSING", "FAILED"]), "FAILED");
  assert.equal(summarizeReportFreshness(["MISSING", "SYNCING"]), "SYNCING");
  assert.equal(summarizeReportFreshness(["MISSING", "OBSERVED_PUBLISHED"]), "PARTIAL");
  assert.equal(summarizeReportFreshness([]), "MISSING");
});
