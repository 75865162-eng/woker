import assert from "node:assert/strict";
import test from "node:test";
import { deriveSellfoxWatermarks, lookupSellfoxWatermark, type SellfoxRunLike } from "@/lib/sellfox/watermark";

const t = (s: string) => new Date(s);

test("按 资源 × 店铺 派生最新成功水位，忽略失败与无店铺范围的 run", () => {
  const runs: SellfoxRunLike[] = [
    { resource: "sales", status: "done", finishedAt: t("2026-10-01T00:00:00Z"), summary: { shopExternalIds: ["shop-a", "shop-b"], reportDate: "2026-09-30" } },
    { resource: "sales", status: "failed", finishedAt: t("2026-10-05T00:00:00Z"), summary: { shopExternalIds: ["shop-a"], reportDate: "2026-10-04" } },
    { resource: "sales", status: "done", finishedAt: t("2026-10-06T00:00:00Z"), summary: { shopExternalIds: ["shop-a"], reportDate: "2026-10-05" } },
    { resource: "ads_report", status: "done", finishedAt: t("2026-10-02T00:00:00Z"), summary: { shopExternalIds: ["shop-a"], endDate: "2026-10-01" } },
    { resource: "sales", status: "done", finishedAt: t("2026-10-07T00:00:00Z"), summary: { shopExternalIds: [] } },
  ];
  const wm = deriveSellfoxWatermarks(runs);

  const salesA = lookupSellfoxWatermark(wm, { resource: "sales", shopExternalId: "shop-a" })!;
  assert.equal(salesA.lastReportDate, "2026-10-05");
  assert.equal(salesA.lastSuccessAt?.toISOString(), "2026-10-06T00:00:00.000Z"); // 失败 run 未推进

  const salesB = lookupSellfoxWatermark(wm, { resource: "sales", shopExternalId: "shop-b" })!;
  assert.equal(salesB.lastReportDate, "2026-09-30");

  const adsA = lookupSellfoxWatermark(wm, { resource: "ads_report", shopExternalId: "shop-a" })!;
  assert.equal(adsA.lastReportDate, "2026-10-01");

  // 同一店铺不同资源水位彼此独立
  assert.notEqual(salesA.lastReportDate, adsA.lastReportDate);
  // 无店铺范围的 run 不产生水位
  assert.equal(lookupSellfoxWatermark(wm, { resource: "sales", shopExternalId: "" }), null);
});

test("缺少完成时间时水位时间保留 null，不伪造", () => {
  const wm = deriveSellfoxWatermarks([
    { resource: "inventory", status: "done", finishedAt: null, summary: { shopExternalIds: ["shop-a"], reportDate: "2026-10-01" } },
  ]);
  const row = lookupSellfoxWatermark(wm, { resource: "inventory", shopExternalId: "shop-a" })!;
  assert.equal(row.lastSuccessAt, null);
  assert.equal(row.lastReportDate, "2026-10-01");
});
