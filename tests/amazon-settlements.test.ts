import test from "node:test";
import assert from "node:assert/strict";
import { parseSettlementPolicy, assertSettlementMarketplaces, parseSettlementReport } from "@/lib/amazon-sync/settlements";
import { parseGetReportsPage, domainReportTypes } from "@/lib/amazon-sync/domain-reports";
const us = "ATVPDKIKX0DER", ca = "A2EUQ1WTGCTBG2";
const bindings = [{ sourceId: "us", revision: 1, sellerAccountId: "us-store", marketplaceId: us }, { sourceId: "ca", revision: 1, sellerAccountId: "ca-store", marketplaceId: ca }];
test("archive-only marketplace approval is explicit and remains within collection scope", () => {
  assert.deepEqual(parseSettlementPolicy({ collectionMarketplaceIds: [us, ca], archiveOnlyMarketplaceIds: [ca] }).archiveOnlyMarketplaceIds, [ca]);
  assert.throws(() => parseSettlementPolicy({ collectionMarketplaceIds: [us], archiveOnlyMarketplaceIds: [ca] }));
});
const header = "settlement-id\tsettlement-start-date\ttransaction-type\tamount-type\tamount-description\tamount\tcurrency\tmarketplace-name\tmarketplace-id\tposted-date\tbuyer-email";
test("settlement collection is explicit and complete before download", () => {
  const policy = parseSettlementPolicy({ collectionMarketplaceIds: [us, ca] });
  assert.deepEqual(assertSettlementMarketplaces([ca, us], policy, us), [...policy.collectionMarketplaceIds]);
  assert.throws(() => assertSettlementMarketplaces([us, ca], parseSettlementPolicy({ collectionMarketplaceIds: [us] }), us), /COLLECTION_SCOPE/);
  assert.throws(() => parseSettlementPolicy({ collectionMarketplaceIds: [us, us] }));
  const response = { reports: [{ reportId: "report", reportType: domainReportTypes.settlements, marketplaceIds: [us, ca] }] };
  assert.throws(() => parseGetReportsPage(response, domainReportTypes.settlements, us), /MULTI_MARKETPLACE/);
  assert.equal(parseGetReportsPage(response, domainReportTypes.settlements, us, policy.collectionMarketplaceIds).reports.length, 1);
  assert.throws(() => parseGetReportsPage(response, domainReportTypes.settlements, us, [us]), /COLLECTION_SCOPE/);
});
test("settlement attribution uses exact identity, never currency or anchor", () => {
  const text = [header,
    "s\t06.10.2026 00:00:00 UTC\tOrder\tItemPrice\tPrincipal\t1.00\tUSD\tAmazon.com\t\t07.10.2026\tprivate@example.invalid",
    "s\t\tOrder\tItemPrice\tPrincipal\t2.00\tCAD\tAmazon.ca\t\t2026-10-08\tprivate@example.invalid",
    "s\t\tOrder\tItemPrice\tPrincipal\t3.00\tUSD\t\t\t\tprivate@example.invalid",
    `s\t\tOrder\tItemPrice\tPrincipal\t4.00\tUSD\tAmazon.ca\t${us}\t\tprivate@example.invalid`,
    "s\t\tOrder\tItemPrice\tPrincipal\t5.00\tMXN\tAmazon.com.mx\t\t\tprivate@example.invalid",
    "s\t\tOrder\tItemPrice\tPrincipal\t6.00\tUSD\tAmazon.not-real\t\t\tprivate@example.invalid"].join("\n");
  const parsed = parseSettlementReport(text, [us, ca], bindings);
  assert.deepEqual(parsed.rows.map(r => r.status), ["ATTRIBUTED", "ATTRIBUTED", "MISSING_MARKETPLACE", "CONFLICTING_MARKETPLACE", "OUT_OF_SCOPE", "CONFLICTING_MARKETPLACE"]);
  assert.deepEqual(parsed.rows.slice(0, 2).map(r => r.binding?.sourceId), ["us", "ca"]);
  assert.deepEqual(parsed.rows.slice(0, 2).map(r => r.row.businessDate), ["2026-10-07", "2026-10-08"]);
  assert.ok(parsed.rows.every(r => !Object.hasOwn(r.row.fields, "buyer-email")));
  assert.equal(parseSettlementReport(text, [us, ca], bindings, { offset: 2, limit: 1 }).rows[0].row.rowNumber, 3);
});
