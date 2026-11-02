import test from "node:test";
import assert from "node:assert/strict";
import { extractPerformanceFields, text, syncSellfoxProductDailySnapshots, type PerformanceCheckpoint } from "@/lib/sellfox/product-performance";
import { SellfoxStoreSyncError } from "@/lib/sellfox/sync-errors";
import { sellfoxPost } from "@/lib/sellfox/client";

import wrapFees from "./fixtures/sellfox/performance-fee-wrap.json";
import serviceFees from "./fixtures/sellfox/performance-service-fees.json";
import nextFees from "./fixtures/sellfox/performance-next-fees.json";
import contigFees from "./fixtures/sellfox/performance-contig-fees.json";
import optionalFees from "./fixtures/sellfox/performance-optional-fees.json";
import miscFees from "./fixtures/sellfox/performance-misc-fees.json";
import storageFees from "./fixtures/sellfox/performance-storage-fees.json";
import adChannels from "./fixtures/sellfox/performance-ad-channel-costs.json";

type Dependencies = NonNullable<Parameters<typeof syncSellfoxProductDailySnapshots>[1]>;
const input = { organizationId: "org-a", workspaceId: "workspace-a", reportDate: "2026-10-24" };

test("performance text extracts scalar identities without stringifying objects", () => {
  const cases: [string, unknown, string][] = [
    ["asinList", " B0X ", "B0X"], ["asinList", [" B0X ", "", " ", "B0Y"], "B0X,B0Y"],
    ["asinList", { asin: "B0X" }, "B0X"], ["asinList", [{ asin: " B0X " }, { asin: "B0Y" }], "B0X,B0Y"],
    ["skuList", { sku: "S1", asin: "B0X" }, "S1"], ["asinList", { sku: "S1", asin: "B0X" }, "B0X"],
    ["mskuList", { sku: "S1", msku: "M1" }, "S1"], ["mskuList", { msku: "M1" }, "M1"],
    ["parentAsinList", { parentAsin: "P1", asin: "B0X" }, "P1"], ["parentAsinList", { asin: "B0X" }, "B0X"],
    ["asinList", { value: " B0X " }, "B0X"], ["asinList", { id: 123 }, "123"], ["asinList", { name: "B0X" }, "B0X"],
    ["asinList", { asin: { asin: "B0X" } }, ""], ["asinList", [{ asin: {} }, {}, ["B0X"]], ""],
    ["asinList", { unexpected: "B0X" }, ""], ["asinList", "[object Object]", ""],
    ["asinList", 0, "0"], ["asinList", false, "false"], ["asinList", null, ""], ["asinList", undefined, ""],
  ];
  for (const [key, value, expected] of cases) {
    const actual = text({ [key]: value }, key);
    assert.equal(actual, expected); assert.doesNotMatch(actual, /\[object Object\]/);
  }
});

test("performance extraction maps confirmed fee and image payload keys to narrow fields", () => {
  assert.deepEqual(extractPerformanceFields({ promotionDiscountAmount: "4.25", giftWrapAmount: 1.5, imageUrl: " https://example.test/item.jpg ", refundPrice: "2.5", refundNum: 1, commodityCost: "3", shippingPrice: 4, taxPrice: "-0.5", headTripPrice: "6.5", avgPurchaseCost: 7, amazonCommissionPrice: "-8", evaluationSaleNum: "0", channelSaleNum: "1" }), {
    promotionDiscount: 4.25, giftWrapFee: 1.5, imageUrl: "https://example.test/item.jpg",
    refundPrice: 2.5, refundNum: 1, commodityCost: 3, shippingPrice: 4, taxPrice: -0.5, headTripPrice: 6.5, avgPurchaseCost: 7, amazonCommissionPrice: -8, evaluationSaleNum: 0, channelSaleNum: 1, adSpCost: null, adSdCost: null, adSbCost: null, adSbvCost: null, adSbsCost: null, fbaStorageFeeAmount: null, fbaLongTermStorageFeeAmount: null, fbaRemovalFeeAmount: null, fbaDisposalFeeAmount: null, customAsinFee: null, customShopFee: null, serviceFeeAmount: null, storageFeeAmount: null, compensationAmount: null, evaluationFee: null, promotionTotalAmount: null, fbaOverageFeeAmount: null, chargebackAmount: null, guaranteeClaimAmount: null, digitalServicesFeeAmount: null, otherPriceAmount: null, shippingChargeAmount: null, regulatoryFeeAmount: null, couponPaymentAmount: null, sellerDealPaymentAmount: null, vineFeeAmount: null, starStorageFeeAmount: null, subscriptionAmount: null, fbaCustomerReturnAmount: null, fbaInboundConvenienceFeeAmount: null, inboundTransportationFeeAmount: null, shippingChargebackAmount: null, giftwrapChargebackAmount: null, costOfPointsGrantedAmount: null, orderOtherPriceAmount: null, fbaInboundTransportationProgramFee: null, aglFeeAmount: null, paidServicesFeeAmount: null, customerReturnHrrUnitFeeAmount: null, amazonUpstreamStorageTransportationFeeAmount: null, amazonUpstreamProcessingFeeAmount: null, mfnPostageFeeAmount: null, adjustmentFeeAmount: null, otherServiceFeeAmount: null, avgHeadTripPrice: null, purchaseRefundPrice: null, revenueAmount: null, fbaPerUnitFulfillmentFeeRefundAmount: null, fbaWeightBasedFeeRefundAmount: null, deferredAmount: null, withheldTaxAmount: null, otherPriceIncomeAmount: null, paymentMethodFeeAmount: null, fixedClosingFeeAmount: null, variableClosingFeeAmount: null, imagingServicesFeeAmount: null, netCoAmount: null, comminglingVatAmount: null, codFeeAmount: null, evaluationCapital: null, evaluationCommission: null, dealPerformanceFeeAmount: null, couponParticipationFeeAmount: null, safetReimbursedAmount: null, affordabilityExpenseAmount: null, withheldFeeAmount: null, chargebackIncomeAmount: null, guaranteeClaimIncomeAmount: null, promotionSalesAmount: null, promotionShippingAmount: null, promotionTaxAmount: null, userNameList: [],
  });
  assert.deepEqual(extractPerformanceFields({ promotionDiscountAmount: null, giftWrapAmount: "", imageUrl: "" }), {
    promotionDiscount: null, giftWrapFee: null, imageUrl: null,
    refundPrice: null, refundNum: null, commodityCost: null, shippingPrice: null, taxPrice: null, headTripPrice: null, avgPurchaseCost: null, amazonCommissionPrice: null, evaluationSaleNum: null, channelSaleNum: null, adSpCost: null, adSdCost: null, adSbCost: null, adSbvCost: null, adSbsCost: null, fbaStorageFeeAmount: null, fbaLongTermStorageFeeAmount: null, fbaRemovalFeeAmount: null, fbaDisposalFeeAmount: null, customAsinFee: null, customShopFee: null, serviceFeeAmount: null, storageFeeAmount: null, compensationAmount: null, evaluationFee: null, promotionTotalAmount: null, fbaOverageFeeAmount: null, chargebackAmount: null, guaranteeClaimAmount: null, digitalServicesFeeAmount: null, otherPriceAmount: null, shippingChargeAmount: null, regulatoryFeeAmount: null, couponPaymentAmount: null, sellerDealPaymentAmount: null, vineFeeAmount: null, starStorageFeeAmount: null, subscriptionAmount: null, fbaCustomerReturnAmount: null, fbaInboundConvenienceFeeAmount: null, inboundTransportationFeeAmount: null, shippingChargebackAmount: null, giftwrapChargebackAmount: null, costOfPointsGrantedAmount: null, orderOtherPriceAmount: null, fbaInboundTransportationProgramFee: null, aglFeeAmount: null, paidServicesFeeAmount: null, customerReturnHrrUnitFeeAmount: null, amazonUpstreamStorageTransportationFeeAmount: null, amazonUpstreamProcessingFeeAmount: null, mfnPostageFeeAmount: null, adjustmentFeeAmount: null, otherServiceFeeAmount: null, avgHeadTripPrice: null, purchaseRefundPrice: null, revenueAmount: null, fbaPerUnitFulfillmentFeeRefundAmount: null, fbaWeightBasedFeeRefundAmount: null, deferredAmount: null, withheldTaxAmount: null, otherPriceIncomeAmount: null, paymentMethodFeeAmount: null, fixedClosingFeeAmount: null, variableClosingFeeAmount: null, imagingServicesFeeAmount: null, netCoAmount: null, comminglingVatAmount: null, codFeeAmount: null, evaluationCapital: null, evaluationCommission: null, dealPerformanceFeeAmount: null, couponParticipationFeeAmount: null, safetReimbursedAmount: null, affordabilityExpenseAmount: null, withheldFeeAmount: null, chargebackIncomeAmount: null, guaranteeClaimIncomeAmount: null, promotionSalesAmount: null, promotionShippingAmount: null, promotionTaxAmount: null, userNameList: [],
  });
  for (const key of ["refundPrice", "refundNum", "commodityCost", "shippingPrice", "taxPrice", "headTripPrice", "avgPurchaseCost", "amazonCommissionPrice", "evaluationSaleNum", "channelSaleNum", "adSpCost", "adSdCost", "adSbCost", "adSbvCost", "adSbsCost", "fbaStorageFeeAmount", "fbaLongTermStorageFeeAmount", "fbaRemovalFeeAmount", "fbaDisposalFeeAmount", "customAsinFee", "customShopFee", "serviceFeeAmount", "storageFeeAmount", "compensationAmount", "evaluationFee", "promotionTotalAmount", "fbaOverageFeeAmount", "chargebackAmount", "guaranteeClaimAmount", "digitalServicesFeeAmount", "otherPriceAmount", "shippingChargeAmount", "regulatoryFeeAmount", "couponPaymentAmount", "sellerDealPaymentAmount", "vineFeeAmount", "starStorageFeeAmount", "subscriptionAmount", "fbaCustomerReturnAmount", "fbaInboundConvenienceFeeAmount", "inboundTransportationFeeAmount", "shippingChargebackAmount", "giftwrapChargebackAmount", "costOfPointsGrantedAmount", "orderOtherPriceAmount", "fbaInboundTransportationProgramFee", "aglFeeAmount", "paidServicesFeeAmount", "customerReturnHrrUnitFeeAmount", "amazonUpstreamStorageTransportationFeeAmount", "amazonUpstreamProcessingFeeAmount", "mfnPostageFeeAmount", "adjustmentFeeAmount", "otherServiceFeeAmount", "avgHeadTripPrice", "purchaseRefundPrice", "revenueAmount", "fbaPerUnitFulfillmentFeeRefundAmount", "fbaWeightBasedFeeRefundAmount", "deferredAmount", "withheldTaxAmount", "otherPriceIncomeAmount", "paymentMethodFeeAmount", "fixedClosingFeeAmount", "variableClosingFeeAmount", "imagingServicesFeeAmount", "netCoAmount", "comminglingVatAmount", "codFeeAmount", "evaluationCapital", "evaluationCommission", "dealPerformanceFeeAmount", "couponParticipationFeeAmount", "safetReimbursedAmount", "affordabilityExpenseAmount", "withheldFeeAmount", "chargebackIncomeAmount", "guaranteeClaimIncomeAmount", "promotionSalesAmount", "promotionShippingAmount", "promotionTaxAmount"] as const) {
    for (const value of [null, undefined, "", 0, "0", 2.5, "-3.25"]) {
      assert.equal(extractPerformanceFields({ [key]: value })[key], value == null || value === "" ? null : Number(value), `${key}: ${value}`);
    }
    for (const invalid of ["invalid", "Infinity", "NaN", "1e999", {}, []]) assert.throws(() => extractPerformanceFields({ [key]: invalid }), /数值无效/);
  }
});

function fixture(storeIds = ["a", "b"]) {
  let rows = new Map<string, unknown>();
  let checkpoint: PerformanceCheckpoint | undefined;
  let failCommit = false;
  let pendingCheckpoint: PerformanceCheckpoint | undefined;
  const calls: { shop: string; page: number }[] = [];
  const modes: boolean[] = [];
  let response: (shop: string, page: number) => unknown = () => ({ rows: [], totalPage: 0 });
  const db = {
    sellfoxStore: { findMany: async (args: { where: { organizationId: string; workspaceId: string } }) => {
      assert.equal(args.where.organizationId, input.organizationId);
      assert.equal(args.where.workspaceId, input.workspaceId);
      return storeIds.map((externalId) => ({ id: `store-${externalId}`, externalId }));
    } },
    $transaction: async (callback: (tx: unknown) => Promise<void>) => {
      const pending = new Map(rows);
      pendingCheckpoint = undefined;
      const tx = { sellfoxProductDailySnapshot: { upsert: async (args: { create: { id: string } }) => { pending.set(args.create.id, args.create); },
        deleteMany: async ({where}: {where: {onlySettle: boolean; syncedAt: {not: Date}}}) => {
          for (const [key, value] of pending) {
            const row = value as {onlySettle: boolean; syncedAt: Date};
            if (row.onlySettle === where.onlySettle && row.syncedAt.getTime() !== where.syncedAt.not.getTime()) pending.delete(key);
          }
        } } };
      await callback(tx);
      if (failCommit) { failCommit = false; throw new Error("DB query with private payload must not escape"); }
      rows = pending;
      if (pendingCheckpoint) checkpoint = pendingCheckpoint;
    },
  } as unknown as Dependencies["db"];
  // Official OpenAPI sends pageNo/pageSize/onlySettle as strings; normalize for fixture assertions.
  const post = (async (_path: string, args: { shopIdList: string[]; pageNo: number | string; onlySettle: boolean | string }) => {
    const pageNo = Number(args.pageNo);
    assert.ok(Number.isInteger(pageNo) && pageNo >= 1, `pageNo must coerce to integer, got ${String(args.pageNo)}`);
    const onlySettle = args.onlySettle === true || args.onlySettle === "true";
    assert.equal(String(args.onlySettle), onlySettle ? "true" : "false");
    modes.push(onlySettle);
    calls.push({ shop: args.shopIdList[0], page: pageNo });
    return response(args.shopIdList[0], pageNo);
  }) as typeof sellfoxPost;
  return {
    dependencies: { db, post }, calls, modes,
    get rows() { return rows; }, get checkpoint() { return checkpoint; },
    setResponse(fn: typeof response) { response = fn; }, failNextCommit() { failCommit = true; },
    async onProgress(update: { checkpoint: PerformanceCheckpoint }, tx?: unknown) {
      if (tx) pendingCheckpoint = structuredClone(update.checkpoint);
      else checkpoint = structuredClone(update.checkpoint);
    },
  };
}

const page = (prefix: string, size: number, totalPage: number) => ({ rows: Array.from({ length: size }, (_, index) => ({ mskuList: [`${prefix}-${index}`], saleNum: 1 })), totalPage });

test("single-object performance identities reach upsert as extracted values", async () => {
  const f = fixture(["a"]);
  f.setResponse(() => ({ rows: [{ mskuList: { msku: "M1" }, skuList: { sku: "S1" }, asinList: { asin: "B0X" }, parentAsinList: { parentAsin: "P1" }, ...adChannels.backfill, ...storageFees.backfill, adTotalCost: "99.5", promotionDiscountAmount: 4.25, giftWrapAmount: 1.5, imageUrl: "https://example.test/item.jpg", headTripPrice: "6.5", avgPurchaseCost: 0, amazonCommissionPrice: "-8", evaluationSaleNum: "0", channelSaleNum: "1" }], totalPage: 1 }));
  await syncSellfoxProductDailySnapshots(input, f.dependencies);
  const row = [...f.rows.values()][0] as Record<string, unknown>;
  assert.deepEqual([row.sourceKey, row.msku, row.sku, row.asin, row.parentAsin], ["M1", "M1", "S1", "B0X", "P1"]);
  assert.deepEqual([row.headTripPrice, row.avgPurchaseCost, row.amazonCommissionPrice], [6.5, 0, -8]);
  assert.deepEqual([row.evaluationSaleNum, row.channelSaleNum], [0, 1]);
  assert.deepEqual(Object.keys(adChannels.backfill).map(key => row[key]), [1.5, 0, 3, 4.25, 5]);
  assert.deepEqual(Object.keys(storageFees.backfill).map(key => row[key]), [1.5, 0, 3, 4.25]);
  assert.equal(row.adCost, 99.5);
  assert.ok(!Object.hasOwn(row, "adTotalCost"));
  assert.ok(!Object.hasOwn(extractPerformanceFields({ adTotalCost: 99.5 }), "adTotalCost"));
  assert.deepEqual([row.promotionDiscount, row.giftWrapFee, row.imageUrl], [4.25, 1.5, "https://example.test/item.jpg"]);
});

test("page transaction rollback retains the failed page; retry replays it and skips completed stores", async () => {
  const f = fixture();
  f.setResponse((shop, pageNo) => shop === "a" ? page(`a-${pageNo}`, 100, 2) : page("b", 1, 1));
  f.failNextCommit();
  const onProgress = f.onProgress;
  await assert.rejects(() => syncSellfoxProductDailySnapshots({ ...input, onProgress }, f.dependencies), (error) => error instanceof SellfoxStoreSyncError && error.retryable);
  assert.equal(f.rows.size, 1);
  assert.equal(f.checkpoint?.stores.a.pageNo, 1);
  assert.equal(f.checkpoint?.stores.a.synced, 0);
  assert.match(f.checkpoint?.stores.a.error ?? "", /本地快照提交失败/);
  assert.doesNotMatch(JSON.stringify(f.checkpoint), /private payload/);
  assert.equal(f.checkpoint?.stores.b.done, true);
  const result = await syncSellfoxProductDailySnapshots({ ...input, checkpoint: f.checkpoint }, f.dependencies);
  assert.equal(result.synced, 201);
  assert.equal(f.rows.size, 201);
  assert.deepEqual(f.calls, [{ shop: "a", page: 1 }, { shop: "b", page: 1 }, { shop: "a", page: 1 }, { shop: "a", page: 2 }]);
  // Replaying independently is safe because business-key upserts replace rows.
  await syncSellfoxProductDailySnapshots({ ...input }, f.dependencies);
  assert.equal(f.rows.size, 201);
});

test("a committed first page resumes at page two and preserves committed counts", async () => {
  const f = fixture(["a"]);
  f.setResponse((_shop, pageNo) => { if (pageNo === 2) throw new Error("transport failure"); return page("a", 100, 2); });
  await assert.rejects(() => syncSellfoxProductDailySnapshots({ ...input, onProgress: f.onProgress }, f.dependencies));
  assert.equal(f.rows.size, 100);
  assert.equal(f.checkpoint?.stores.a.pageNo, 2);
  assert.equal(f.checkpoint?.stores.a.synced, 100);
  f.setResponse(() => page("a-tail", 1, 2));
  const result = await syncSellfoxProductDailySnapshots({ ...input, checkpoint: f.checkpoint }, f.dependencies);
  assert.equal(result.synced, 101);
  assert.equal(f.rows.size, 101);
  assert.deepEqual(f.calls.map((call) => call.page), [1, 2, 2]);
});

test("invalid schema and missing identities fail without writes, while a legal empty page succeeds", async () => {
  for (const response of [{ unexpected: [] }, { rows: [{}], totalPage: 1 }, page("duplicate", 1, 0)]) {
    const f = fixture(["a"]); f.setResponse(() => response);
    await assert.rejects(() => syncSellfoxProductDailySnapshots({ ...input, onProgress: f.onProgress }, f.dependencies), (error) => error instanceof SellfoxStoreSyncError && !error.retryable);
    assert.equal(f.rows.size, 0);
  }
  const empty = fixture(["a"]);
  assert.equal((await syncSellfoxProductDailySnapshots(input, empty.dependencies)).synced, 0);
  await assert.rejects(() => syncSellfoxProductDailySnapshots(input, fixture([]).dependencies), /没有可同步店铺/);
  await assert.rejects(() => syncSellfoxProductDailySnapshots({ ...input, storeExternalIds: ["a", "missing"] }, fixture(["a"]).dependencies), /不属于当前工作区/);
});

test("corrupt checkpoints cannot silently finish or send invalid page requests", async () => {
  const f = fixture(["a"]);
  await assert.rejects(() => syncSellfoxProductDailySnapshots({ ...input, checkpoint: { stores: { a: { pageNo: 10001, synced: 0, done: true } } } }, f.dependencies), /同步失败/);
  assert.equal(f.calls.length, 0);
});


test("onlySettle is requested and stored as a separate profit scope without replacing all-orders rows", async () => {
  const f = fixture(["a"]); f.setResponse(() => page("same-msku", 1, 1));
  await syncSellfoxProductDailySnapshots(input, f.dependencies);
  const result = await syncSellfoxProductDailySnapshots({ ...input, onlySettle: true }, f.dependencies);
  assert.deepEqual(f.modes, [false, true]); assert.equal(result.onlySettle, true);
  assert.equal(f.rows.size, 2);
  assert.deepEqual([...f.rows.values()].map(row => (row as { onlySettle: boolean }).onlySettle), [false, true]);
});


test("complete empty settled response clears only prior settled scope, while failed requests retain it", async () => {
  const f = fixture(["a"]); f.setResponse(() => page("same", 1, 1));
  await syncSellfoxProductDailySnapshots({...input, capturedAt:"2026-10-25T00:00:00Z"}, f.dependencies);
  await syncSellfoxProductDailySnapshots({...input, onlySettle:true, capturedAt:"2026-10-25T00:00:00Z"}, f.dependencies);
  f.setResponse(() => { throw Error("transport failure"); });
  await assert.rejects(() => syncSellfoxProductDailySnapshots({...input, onlySettle:true, capturedAt:"2026-10-25T01:00:00Z"}, f.dependencies));
  assert.equal(f.rows.size, 2);
  f.setResponse(() => ({rows:[],totalPage:0}));
  await syncSellfoxProductDailySnapshots({...input, onlySettle:true, capturedAt:"2026-10-25T01:00:00Z"}, f.dependencies);
  assert.equal(f.rows.size, 1);
  assert.equal(([...f.rows.values()][0] as {onlySettle:boolean}).onlySettle, false);
});


test("settled IDs cannot collide with an all-orders MSKU that ends in settled", async () => {
  const f = fixture(["a"]);
  f.setResponse(() => ({rows:[{mskuList:["MSKU-settled"],saleNum:1}],totalPage:1}));
  await syncSellfoxProductDailySnapshots(input, f.dependencies);
  f.setResponse(() => ({rows:[{mskuList:["MSKU"],saleNum:1}],totalPage:1}));
  await syncSellfoxProductDailySnapshots({...input,onlySettle:true}, f.dependencies);
  assert.equal(f.rows.size,2);
});


test("performance salesperson projects only distinct nonempty strings, never Listing developer", () => {
  assert.deepEqual(extractPerformanceFields({ userNameList: [" 温见清 ", "陈馨", "温见清", "", "  ", null, 1, { name: "虚构" }] }).userNameList.sort(), ["温见清", "陈馨"].sort());
  for (const userNameList of [undefined, null, "温见清", {}, [], 1]) {
    assert.deepEqual(extractPerformanceFields({ userNameList, developer: "开发员" }).userNameList, []);
  }
});

test("misc profit fee fixture projects same-name numeric keys without Listing aliases", () => {
  const keys = Object.keys(miscFees.backfill) as (keyof typeof miscFees.backfill)[];
  for (const [payload, expected] of [[miscFees.backfill, [1.5, 0, 3, 4.25, 5, 6]], [miscFees.insert, [0, 2.5, 4, 5, 6, 7]]] as const) {
    const actual = extractPerformanceFields(payload);
    assert.deepEqual(keys.map(key => actual[key]), expected);
  }
  for (const key of keys) {
    assert.throws(() => extractPerformanceFields({ [key]: "invalid" }), /数值无效/);
    assert.equal(extractPerformanceFields({ [key]: null })[key], null);
    assert.equal(extractPerformanceFields({ fbaFees: 999, referralFee: 999, monthlyStorageFee: 999 })[key], null);
  }
  assert.equal(extractPerformanceFields({ storageFeeAmount: 7, fbaStorageFeeAmount: 11 }).storageFeeAmount, 7);
  assert.equal(extractPerformanceFields({ storageFeeAmount: 7, fbaStorageFeeAmount: 11 }).fbaStorageFeeAmount, 11);
});


test("optional profit fee fixture preserves zero and distinct promo discount without Listing aliases", async () => {
  const keys = Object.keys(optionalFees.backfill) as (keyof typeof optionalFees.backfill)[];
  for (const [payload, expected] of [[optionalFees.backfill, [1.5, 0, 3, 4.25, 5, 6, 7, 8]], [optionalFees.insert, [0, 2.5, 4, 5, 6, 7, 8, 9]], [optionalFees.cad, [10, 20, 30, 40, 50, 60, 70, 80]]] as const) {
    const actual = extractPerformanceFields(payload);
    assert.deepEqual(keys.map(key => actual[key]), expected);
  }
  for (const key of keys) {
    for (const value of [null, undefined, "", 0, "0", -2.5, "3.25"]) {
      assert.equal(extractPerformanceFields({ [key]: value })[key], value == null || value === "" ? null : Number(value));
    }
    for (const invalid of ["bad", "Infinity", "NaN", "1e999", {}, [], true]) assert.throws(() => extractPerformanceFields({ [key]: invalid }), /数值无效/);
    assert.equal(extractPerformanceFields({ promotionDiscountAmount: 99, fbaFees: 999, referralFee: 999, monthlyStorageFee: 999 })[key], null);
  }
  const promo = extractPerformanceFields({ promotionTotalAmount: 5, promotionDiscountAmount: 11 });
  assert.equal(promo.promotionTotalAmount, 5);
  assert.equal(promo.promotionDiscount, 11);
  const f = fixture(["a"]);
  f.setResponse(() => ({ rows: [{ mskuList: ["fees"], ...optionalFees.insert, promotionDiscountAmount: 11 }], totalPage: 1 }));
  await syncSellfoxProductDailySnapshots(input, f.dependencies);
  const saved = [...f.rows.values()][0] as Record<string, unknown>;
  assert.deepEqual(keys.map(key => saved[key]), [0, 2.5, 4, 5, 6, 7, 8, 9]);
  assert.equal(saved.promotionDiscount, 11);
});

test("contiguous fee fixture preserves zero and distinct same-name facts without Listing aliases", async () => {
  const keys = Object.keys(contigFees.backfill) as (keyof typeof contigFees.backfill)[];
  for (const [payload, expected] of [[contigFees.backfill, [1.5, 0, 3, 14.25, 5, 6, 7, 8, 9, 10, 11, 12]], [contigFees.insert, [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]], [contigFees.cad, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]]] as const) {
    const actual = extractPerformanceFields(payload);
    assert.deepEqual(keys.map(key => actual[key]), expected);
  }
  for (const key of keys) {
    for (const value of [null, undefined, "", 0, "0", -2.5, "3.25"]) {
      assert.equal(extractPerformanceFields({ [key]: value })[key], value == null || value === "" ? null : Number(value));
    }
    for (const invalid of ["bad", "Infinity", "NaN", "1e999", {}, [], true]) assert.throws(() => extractPerformanceFields({ [key]: invalid }), /数值无效/);
    assert.equal(extractPerformanceFields({ promotionDiscountAmount: 99, fbaFees: 999, referralFee: 999, monthlyStorageFee: 999 })[key], null);
  }
  const distinct = extractPerformanceFields({ starStorageFeeAmount: 1, storageFeeAmount: 2, fbaStorageFeeAmount: 3, fbaLongTermStorageFeeAmount: 4, fbaOverageFeeAmount: 5, shippingChargebackAmount: 6, shippingChargeAmount: 7, giftwrapChargebackAmount: 8, giftWrapAmount: 9, orderOtherPriceAmount: 10, otherPriceAmount: 11 });
  assert.deepEqual([distinct.starStorageFeeAmount, distinct.storageFeeAmount, distinct.fbaStorageFeeAmount, distinct.fbaLongTermStorageFeeAmount, distinct.fbaOverageFeeAmount, distinct.shippingChargebackAmount, distinct.shippingChargeAmount, distinct.giftwrapChargebackAmount, distinct.giftWrapFee, distinct.orderOtherPriceAmount, distinct.otherPriceAmount], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const promo = extractPerformanceFields({ promotionTotalAmount: 5, promotionDiscountAmount: 11 });
  assert.equal(promo.promotionTotalAmount, 5);
  assert.equal(promo.promotionDiscount, 11);
  const f = fixture(["a"]);
  f.setResponse(() => ({ rows: [{ mskuList: ["fees"], ...contigFees.insert, promotionDiscountAmount: 11 }], totalPage: 1 }));
  await syncSellfoxProductDailySnapshots(input, f.dependencies);
  const saved = [...f.rows.values()][0] as Record<string, unknown>;
  assert.deepEqual(keys.map(key => saved[key]), [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.equal(saved.promotionDiscount, 11);
});

test("next fee fixture preserves zero and distinct same-name facts without Listing aliases", async () => {
  const keys = Object.keys(nextFees.backfill) as (keyof typeof nextFees.backfill)[];
  for (const [payload, expected] of [[nextFees.backfill, [1.5, 0, 3, 14.25, 5, 6, 7, 8, 9, 10, 11, 12]], [nextFees.insert, [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]], [nextFees.cad, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]]] as const) {
    const actual = extractPerformanceFields(payload);
    assert.deepEqual(keys.map(key => actual[key]), expected);
  }
  for (const key of keys) {
    for (const value of [null, undefined, "", 0, "0", -2.5, "3.25"]) {
      assert.equal(extractPerformanceFields({ [key]: value })[key], value == null || value === "" ? null : Number(value));
    }
    for (const invalid of ["bad", "Infinity", "NaN", "1e999", {}, [], true]) assert.throws(() => extractPerformanceFields({ [key]: invalid }), /数值无效/);
    assert.equal(extractPerformanceFields({ promotionDiscountAmount: 99, fbaFees: 999, referralFee: 999, monthlyStorageFee: 999 })[key], null);
  }
  const distinct = extractPerformanceFields({ avgHeadTripPrice: 1, headTripPrice: 2, purchaseRefundPrice: 3, refundPrice: 4, revenueAmount: 5, saleRevenue: 6, netRevenue: 7 });
  assert.deepEqual([distinct.avgHeadTripPrice, distinct.headTripPrice, distinct.purchaseRefundPrice, distinct.refundPrice, distinct.revenueAmount], [1, 2, 3, 4, 5]);
  const promo = extractPerformanceFields({ promotionTotalAmount: 5, promotionDiscountAmount: 11 });
  assert.equal(promo.promotionTotalAmount, 5);
  assert.equal(promo.promotionDiscount, 11);
  const f = fixture(["a"]);
  f.setResponse(() => ({ rows: [{ mskuList: ["fees"], ...nextFees.insert, promotionDiscountAmount: 11, salePrice: 600, salesPriceNet: 500 }], totalPage: 1 }));
  await syncSellfoxProductDailySnapshots(input, f.dependencies);
  const saved = [...f.rows.values()][0] as Record<string, unknown>;
  assert.deepEqual(keys.map(key => saved[key]), [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.equal(saved.promotionDiscount, 11);
  assert.deepEqual([saved.revenueAmount, saved.saleRevenue, saved.netRevenue], [13, 600, 500]);
});

test("service fee fixture preserves zero and distinct same-name facts without Listing aliases", async () => {
  const keys = Object.keys(serviceFees.backfill) as (keyof typeof serviceFees.backfill)[];
  for (const [payload, expected] of [[serviceFees.backfill, [1.5, 0, 3, 14.25, 5, 6, 7, 8, 9, 10, 11, 12]], [serviceFees.insert, [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]], [serviceFees.cad, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]]] as const) {
    const actual = extractPerformanceFields(payload);
    assert.deepEqual(keys.map(key => actual[key]), expected);
  }
  for (const key of keys) {
    for (const value of [null, undefined, "", 0, "0", -2.5, "3.25"]) {
      assert.equal(extractPerformanceFields({ [key]: value })[key], value == null || value === "" ? null : Number(value));
    }
    for (const invalid of ["bad", "Infinity", "NaN", "1e999", {}, [], true]) assert.throws(() => extractPerformanceFields({ [key]: invalid }), /数值无效/);
    assert.equal(extractPerformanceFields({ promotionDiscountAmount: 99, fbaFees: 999, referralFee: 999, monthlyStorageFee: 999 })[key], null);
  }
  const distinct = extractPerformanceFields({ otherPriceIncomeAmount: 1, otherPriceAmount: 2, orderOtherPriceAmount: 3, deferredAmount: 4, withheldTaxAmount: 5, taxPrice: 6 });
  assert.deepEqual([distinct.otherPriceIncomeAmount, distinct.otherPriceAmount, distinct.orderOtherPriceAmount, distinct.deferredAmount, distinct.withheldTaxAmount, distinct.taxPrice], [1, 2, 3, 4, 5, 6]);
  const f = fixture(["a"]);
  f.setResponse(() => ({ rows: [{ mskuList: ["fees"], ...serviceFees.insert }], totalPage: 1 }));
  await syncSellfoxProductDailySnapshots(input, f.dependencies);
  const saved = [...f.rows.values()][0] as Record<string, unknown>;
  assert.deepEqual(keys.map(key => saved[key]), [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
});

test("performance fee-wrap shared fixture extracts nonzero, zero, missing and null; rejects illegal new rows", () => {
  for (const group of [wrapFees.backfill, wrapFees.insert, wrapFees.cad]) {
    const fields = extractPerformanceFields(group);
    for (const [key, value] of Object.entries(group)) assert.equal(fields[key as keyof typeof fields], Number(value));
  }
  for (const key of Object.keys(wrapFees.backfill)) {
    assert.equal(extractPerformanceFields({})[key as keyof ReturnType<typeof extractPerformanceFields>], null);
    const value = wrapFees.invalid[key as keyof typeof wrapFees.invalid];
    if (value === null || value === "") {
      assert.equal(extractPerformanceFields({ [key]: value })[key as keyof ReturnType<typeof extractPerformanceFields>], null);
    } else if (value === " ") assert.equal(extractPerformanceFields({ [key]: value })[key as keyof ReturnType<typeof extractPerformanceFields>], 0);
    else assert.throws(() => extractPerformanceFields({ [key]: value }), /数值无效/);
  }
});
