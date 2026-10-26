import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseSellfoxAdCampaignReport } from "@/lib/sellfox/ads-campaign-contract";
import { parseSellfoxAdGroupReport } from "@/lib/sellfox/ads-ad-group-contract";
import { parseSellfoxAdPlacementReport } from "@/lib/sellfox/ads-placement-contract";
import { readSellfoxView, sellfoxViewParams, sellfoxAdsResource, sellfoxColumnDomain } from "@/lib/sellfox/workbench-view";
const scope = { storeName: "Fixture", startDate: "2026-10-24", endDate: "2026-10-24" };
const base = { 店铺: "Fixture", 日期: "2026-10-24", 广告活动ID: "campaign", 广告曝光量: 10, 广告点击量: 2, 广告花费: 1.5, 广告订单量: 0, 广告销售额: 0 };
async function xlsx(rows: Record<string, unknown>[], headers = Object.keys(rows[0])) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("report");
  sheet.addRow(headers); for (const row of rows) sheet.addRow(headers.map(key => row[key] ?? null));
  return Buffer.from(await book.xlsx.writeBuffer());
}
test("campaign requires no group/product ID, retains optional aliases, null metrics/currency and raw evidence", async () => {
  const raw = { ...base, 广告活动名称: "Campaign", ASIN: "B0TEST", SKU: "MSKU", 币种: "USD", 广告花费: null };
  const [row] = await parseSellfoxAdCampaignReport(await xlsx([raw]), scope);
  assert.equal("adGroupId" in row, false); assert.equal(row.campaignName, "Campaign");
  assert.equal(row.asin, "B0TEST"); assert.equal(row.msku, "MSKU"); assert.equal(row.cost, null); assert.equal(row.currency, null);
  assert.equal(row.adOrders, 0); assert.deepEqual(row.payload, raw);
  assert.equal((await parseSellfoxAdCampaignReport(await xlsx([{ ...base, 广告活动: "Alias" }]), scope))[0].campaignName, "Alias");
  await assert.rejects(async () => parseSellfoxAdCampaignReport(await xlsx([{ ...base, 广告组ID: "g1" }, { ...base, 广告组ID: "g2" }]), scope), /重复实体/);
});
test("ad group requires campaign/group, names are optional aliases and IDs differ across groups/campaigns", async () => {
  const raw = { ...base, 广告组ID: "g1", 广告组名称: "Group", 投放: "keyword", 匹配类型: "EXACT" };
  const [row] = await parseSellfoxAdGroupReport(await xlsx([raw]), scope);
  assert.equal(row.adGroupName, "Group"); assert.equal(row.targetingText, "keyword"); assert.equal(row.matchType, "EXACT");
  assert.equal((await parseSellfoxAdGroupReport(await xlsx([{ ...base, 广告组ID: "g1", 广告组: "Alias" }]), scope))[0].adGroupName, "Alias");
  assert.equal((await parseSellfoxAdGroupReport(await xlsx([raw, { ...raw, 广告组ID: "g2" }, { ...raw, 广告活动ID: "c2" }]), scope)).length, 3);
  for (const rows of [[base], [{ ...raw, 广告组ID: " " }], [raw, raw]]) await assert.rejects(async () => parseSellfoxAdGroupReport(await xlsx(rows), scope));
});
test("placement requires exact 广告位, optional group metadata never changes campaign/placement identity", async () => {
  const raw = { ...base, 广告位: "搜索结果顶部" };
  const [row] = await parseSellfoxAdPlacementReport(await xlsx([raw]), scope);
  assert.equal(row.placement, "搜索结果顶部"); assert.equal(row.adGroupId, null);
  assert.equal((await parseSellfoxAdPlacementReport(await xlsx([{ ...raw, 广告组ID: "g" }]), scope))[0].adGroupId, "g");
  for (const rows of [[{ ...base, placement: "top" }], [{ ...raw, 广告位: " " }], [raw, raw], [{ ...raw, 广告组ID: "g1" }, { ...raw, 广告组ID: "g2" }]]) {
    await assert.rejects(async () => parseSellfoxAdPlacementReport(await xlsx(rows), scope));
  }
  const rows = await parseSellfoxAdPlacementReport(await xlsx([raw, { ...raw, 广告位: "商品页面" }, { ...raw, 广告活动ID: "c2" }]), scope);
  assert.equal(rows.length, 3);
});
for (const [name, parse, extra] of [["campaign", parseSellfoxAdCampaignReport, {}], ["group", parseSellfoxAdGroupReport, { 广告组ID: "g" }], ["placement", parseSellfoxAdPlacementReport, { 广告位: "top" }]] as const) {
  test(`${name} fails closed for foreign/date/identity/metric/column/formula errors, accepts valid empty report`, async () => {
    const raw = { ...base, ...extra };
    for (const patch of [{ 店铺: "foreign" }, { 日期: "2026-02-29" }, { 日期: "2026-10-23" }, { 广告活动ID: " " }, { 广告点击量: 1.5 }, { 广告花费: { formula: "1+1", result: 2 } }]) {
      await assert.rejects(async () => parse(await xlsx([{ ...raw, ...patch }]), scope));
    }
    await assert.rejects(async () => parse(await xlsx([raw], Object.keys(raw).filter(key => key !== "广告花费")), scope), /缺少/);
    await assert.rejects(async () => parse(await xlsx([raw], [...Object.keys(raw), "广告花费"]), scope), /重复列/);
    await assert.rejects(async () => parse(await xlsx([raw], [...Object.keys(raw), "asin", "ASIN"]), scope), /重复列/);
    assert.deepEqual(await parse(await xlsx([], Object.keys(raw)), scope), []);
  });
}
test("Phase B URL tabs map to distinct resources/column domains and retain typed placement search", () => {
  for (const [tab, resource] of [["campaign", "ads_campaign"], ["adGroup", "ads_ad_group"], ["placement", "ads_placement"]]) {
    const view = readSellfoxView(new URLSearchParams(`domain=ads&adsTab=${tab}&searchType=placement&search=top`));
    assert.equal(view.adsTab, tab); assert.equal(view.searchType, "placement");
    assert.equal(sellfoxAdsResource(view), resource); assert.equal(sellfoxColumnDomain(view), resource);
    assert.equal(readSellfoxView(sellfoxViewParams(view)).adsTab, tab);
    assert.equal(sellfoxViewParams(view, true).get("layout"), "workbench");
  }
});
