import assert from "node:assert/strict";
import test from "node:test";
import { formatSiteStore, siteCodeForDisplay, siteCodeOf } from "@/lib/sellfox/marketplace-site";

test("siteCodeOf maps known marketplaces to country codes", () => {
  assert.equal(siteCodeOf("ATVPDKIKX0DER"), "US");
  assert.equal(siteCodeOf("A2EUQ1WTGCTBG2"), "CA");
  assert.equal(siteCodeOf("A1PA6795UKMFR9"), "DE");
  assert.equal(siteCodeOf("A1VC38T7YXB528"), "JP");
});

test("siteCodeOf falls back to raw id without guessing", () => {
  assert.equal(siteCodeOf("UNKNOWN_MARKETPLACE"), "UNKNOWN_MARKETPLACE");
  assert.equal(siteCodeOf(""), "");
  assert.equal(siteCodeOf(null), "");
});

test("formatSiteStore produces lowercase site-store label", () => {
  assert.equal(formatSiteStore("ATVPDKIKX0DER", "aoocy"), "us-aoocy");
  assert.equal(formatSiteStore("A2EUQ1WTGCTBG2", "aoocy"), "ca-aoocy");
  assert.equal(formatSiteStore("A1PA6795UKMFR9", "德国店"), "de-德国店");
});

test("formatSiteStore handles missing parts", () => {
  assert.equal(formatSiteStore("ATVPDKIKX0DER", ""), "us");
  assert.equal(formatSiteStore("", "aoocy"), "aoocy");
  assert.equal(formatSiteStore("", ""), "—");
});

test("siteCodeForDisplay returns lowercase site code for display only", () => {
  assert.equal(siteCodeForDisplay("ATVPDKIKX0DER"), "us");
  assert.equal(siteCodeForDisplay("A1PA6795UKMFR9"), "de");
  assert.equal(siteCodeForDisplay("UNKNOWN"), "unknown");
  assert.equal(siteCodeForDisplay(""), "");
});
