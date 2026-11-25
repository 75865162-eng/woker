import test from "node:test";
import assert from "node:assert/strict";
import {
  siteZoneOf, siteCodeZoneOf, siteTimezoneCoverage, isValidIanaZone,
  SUPPLEMENTAL_SITE_ZONES, ALL_SITE_ZONES,
} from "../src/lib/amazon-sync/site-timezone-registry";

test("补齐 3 个缺失站点时区（PL/BE/IE），且均为有效 IANA 时区", () => {
  assert.equal(Object.keys(SUPPLEMENTAL_SITE_ZONES).length, 3);
  assert.equal(siteZoneOf("A1C3SOZRARQ6R3"), "Europe/Warsaw");
  assert.equal(siteZoneOf("AMEN7PMS3EDWL"), "Europe/Brussels");
  assert.equal(siteZoneOf("A28R8C7NBKEWEA"), "Europe/Dublin");
  for (const zone of Object.values(SUPPLEMENTAL_SITE_ZONES)) {
    assert.equal(isValidIanaZone(zone), true, `${zone} 应为有效 IANA 时区`);
  }
});

test("既有站点时区不受影响（与 date-range.ts 一致）", () => {
  assert.equal(siteZoneOf("ATVPDKIKX0DER"), "America/Los_Angeles");
  assert.equal(siteZoneOf("A1PA6795UKMFR9"), "Europe/Berlin");
  assert.equal(siteZoneOf("A1VC38T7YXB528"), "Asia/Tokyo");
});

test("全量站点码 → 时区查询（含补充站点）", () => {
  assert.equal(siteCodeZoneOf("US"), "America/Los_Angeles");
  assert.equal(siteCodeZoneOf("PL"), "Europe/Warsaw");
  assert.equal(siteCodeZoneOf("be"), "Europe/Brussels");
  assert.equal(siteCodeZoneOf("IE"), "Europe/Dublin");
});

test("未知站点/空值返回 null（fail-closed，不用 Asia/Shanghai 兜底）", () => {
  assert.equal(siteZoneOf("UNKNOWN_MARKETPLACE"), null);
  assert.equal(siteZoneOf(""), null);
  assert.equal(siteZoneOf(null), null);
  assert.equal(siteCodeZoneOf("XX"), null);
  assert.equal(siteCodeZoneOf(""), null);
});

test("覆盖度审计：21 站点全覆盖，缺时区为 0，不静默忽略", () => {
  const cov = siteTimezoneCoverage();
  assert.equal(cov.totalSites, 21);
  assert.equal(cov.coveredSites, 21);
  assert.deepEqual(cov.missingSites, []);
  assert.equal(cov.coverage, 1);
  assert.equal(cov.supplementalCount, 3);
});

test("所有全量时区均为有效 IANA 时区", () => {
  for (const [id, zone] of Object.entries(ALL_SITE_ZONES)) {
    assert.equal(isValidIanaZone(zone), true, `${id} → ${zone} 无效`);
  }
});
