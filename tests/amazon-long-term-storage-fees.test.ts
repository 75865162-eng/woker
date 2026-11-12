import test from "node:test";
import assert from "node:assert/strict";
import { latestClosedStorageFeeMonth, longTermStorageFeeRunWindow, nextStorageFeeMonth } from "@/lib/amazon-sync/long-term-storage-fees";
import { assertDomainReportRoles, parseDomainReport } from "@/lib/amazon-sync/domain-reports";
import { reportBusinessFields } from "@/lib/amazon-sync/report-business-fields";
import { automaticAdapter } from "@/lib/amazon-sync/automatic-adapters";
import { planAutomaticTask } from "@/lib/amazon-sync/automatic-planner";
import { datasetForTable } from "@/lib/amazon-sync/mcp-datasets";

const now = new Date("2026-11-10T12:00:00Z");
test("long-term storage fees freeze exactly one calendar month including leap year and year rollover", () => {
  const latest = latestClosedStorageFeeMonth(now);
  assert.deepEqual(latest, { from: "2026-10-01", to: "2026-10-31", dataStartTime: "2026-10-01T00:00:00Z", dataEndTime: "2026-11-01T00:00:00Z" });
  assert.equal(longTermStorageFeeRunWindow({ from: "2024-02-01", to: "2024-02-29" }, now).dataEndTime, "2024-03-01T00:00:00Z");
  assert.equal(latestClosedStorageFeeMonth(new Date("2026-01-01T00:00:00Z")).from, "2025-12-01");
  assert.throws(() => longTermStorageFeeRunWindow({ from: "9999-12-01", to: "9999-12-31" }, now));
  for (const bad of [null, { from: "2026-11-01", to: "2026-11-30" }, { from: "2026-10-02", to: "2026-10-31" }, { from: "2026-10-01", to: "2026-11-30" }, { ...latest, dataEndTime: "2026-10-31T23:59:59Z" }]) assert.throws(() => longTermStorageFeeRunWindow(bad, now));
});

test("monthly planner resumes original window, catches up months and refreshes latest without invented retention", async () => {
  const first = nextStorageFeeMonth(null, now);
  const cursor = { watermarkFrom: new Date(first.dataStartTime), watermarkTo: new Date(first.dataEndTime), status: "FAILED" };
  assert.deepEqual(nextStorageFeeMonth(cursor, new Date("2027-01-05T00:00:00Z")), first);
  assert.equal(nextStorageFeeMonth({ ...cursor, status: "SUCCEEDED" }, new Date("2027-01-05T00:00:00Z")).from, "2026-11-01");
  assert.deepEqual(nextStorageFeeMonth({ ...cursor, status: "SUCCEEDED" }, now), first);
  assert.throws(() => nextStorageFeeMonth({ ...cursor, watermarkTo: new Date("2026-10-31T23:59:59Z") }, now));
  const source = { id: "source", resource: "long_term_storage_fees", revision: 1, authorizationId: "auth", marketplaceId: "ATVPDKIKX0DER", orderPolicy: null, financePolicy: null, returnsPolicy: null, domainPolicy: null, authorization: { revision: 1, status: "CONFIGURED" }, resourceCursor: null };
  const plan = { id: "plan", revision: 1, maxAttempts: 3, priority: 1, intervalMinutes: 1440 };
  const adapter = automaticAdapter("long_term_storage_fees")!;
  const initial = await planAutomaticTask(adapter, { organizationId: "fixture", workspaceId: "default" }, source, plan, now);
  assert.deepEqual(initial?.payload.reportWindow, first);
  const refresh = await planAutomaticTask(adapter, { organizationId: "fixture", workspaceId: "default" }, { ...source, resourceCursor: { ...cursor, status: "SUCCEEDED" } }, plan, now);
  assert.ok(refresh?.keyTo?.includes(":refresh:"));
  assert.notEqual(initial?.keyTo, refresh?.keyTo);
  assert.equal(adapter.requiredAnyRoles?.includes("Pricing"), true);
});

test("monthly fee parser retains exact charged values, tier rows, currency and unknown fields", () => {
  const header = "snapshot-date\tsku\tfnsku\tasin\tqty-charged\tamount-charged\tcurrency\tper-unit-volume\trate-surcharge\tsurcharge-age-tier\tunknown_field";
  const row = "2026-10-15\tsku1\tfn1\tB012345678\t9007199254740993123\t12345678901234567890.123400\tUSD\t0.0000000000001\t1.2500\t365+\t";
  const text = header + "\n" + row;
  const parsed = parseDomainReport("long_term_storage_fees", text, { storageFeeWindow: latestClosedStorageFeeMonth(now) });
  assert.equal(parsed.rows[0].businessDate, "2026-10-15");
  assert.equal(parsed.rows[0].amountOriginal, "12345678901234567890.123400");
  assert.equal(parsed.rows[0].quantityOriginal, "9007199254740993123");
  assert.equal(parsed.rows[0].fields.unknown_field, "");
  assert.equal(reportBusinessFields("long_term_storage_fees", parsed.rows[0].fields).surchargeRateOriginal, "1.2500");
  assert.equal(parseDomainReport("long_term_storage_fees", text + "\n" + row.replace("365+", "271-365")).rows.length, 2);
  assert.equal(parseDomainReport("long_term_storage_fees", text, { offset: 1 }).rows.length, 0);
  for (const bad of [text.replace("2026-10-15", "2026-09-15"), text.replace("2026-10-15", "2026-02-30"), text.replace("12345678901234567890.123400", "NaN"), text.replace("9007199254740993123", "-1"), text.replace("USD", ""), text.replace("qty-charged", "missing")]) assert.throws(() => parseDomainReport("long_term_storage_fees", bad, { storageFeeWindow: latestClosedStorageFeeMonth(now) }));
  assert.throws(() => assertDomainReportRoles("long_term_storage_fees", { approvedRoles: [], rolesAttestedAt: null }));
  assert.equal(datasetForTable("long_term_storage_fees").publicationPolicy, "latest_published_report_or_explicit_report_version");
});
