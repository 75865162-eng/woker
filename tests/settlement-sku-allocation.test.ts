import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NormalizedDomainReportRow } from "@/lib/amazon-sync/domain-reports";
import {
  classifySettlementRow,
  settlementFeePool,
  buildDedupeKey,
  buildOverlapKey,
  FEE_POOL_KEYS,
  type SettlementAllocationScope,
} from "@/lib/amazon-sync/settlement-fee-classification";
import {
  allocateSettlementToSku,
  type AllocateSettlementOptions,
} from "@/lib/amazon-sync/settlement-sku-allocation";
import { unitsAmount } from "@/lib/finance/open-item-rules";

/**
 * 合成结算行（等价手写 TSV，纯内存、零凭据、不加载 .env、不发网络请求）。
 * 列顺序与 tests/amazon-settlements.test.ts 的结算 TSV 一致：
 * settlement-id / settlement-start-date / transaction-type / amount-type /
 * amount-description / amount / currency / sku / order-id / quantity / marketplace-id
 */
const HEADERS = [
  "settlement-id", "settlement-start-date", "transaction-type", "amount-type",
  "amount-description", "amount", "currency", "sku", "order-id", "quantity", "marketplace-id",
] as const;

type LineInit = {
  transactionType: string;
  amountType: string;
  amountDescription: string;
  amount: string;
  currency?: string;
  sku?: string;
  orderId?: string;
  quantity?: string;
  date?: string;
  settlementId?: string;
  marketplaceId?: string;
};
function line(init: LineInit): string {
  const d = {
    currency: "USD", sku: "", orderId: "", quantity: "", date: "2026-10-01",
    settlementId: "S-1", marketplaceId: "ATVPDKIKX0DER", ...init,
  };
  return [
    d.settlementId, d.date, d.transactionType, d.amountType, d.amountDescription,
    d.amount, d.currency, d.sku, d.orderId, d.quantity, d.marketplaceId,
  ].join("\t");
}
function parseSyntheticTsv(lines: string[]): NormalizedDomainReportRow[] {
  return lines.map((text, index) => {
    const cells = text.split("\t");
    const fields = Object.fromEntries(HEADERS.map((header, i) => [header, cells[i] ?? ""]));
    return {
      rowNumber: index + 1,
      rowHash: createHash("sha256").update(text).digest("hex"),
      businessDateRaw: cells[1] || null,
      businessDate: cells[1] || null,
      orderId: cells[8] || null,
      sellerSku: cells[7] || null,
      asin: null,
      transactionType: cells[2] || null,
      amountType: cells[3] || null,
      amountDescription: cells[4] || null,
      amountOriginal: cells[5] || null,
      currencyCode: cells[6] || null,
      quantityOriginal: cells[9] || null,
      fields,
    };
  });
}

const scope: SettlementAllocationScope = {
  organizationId: "org-1",
  workspaceId: "ws-1",
  settlementId: "S-1",
  currency: "USD",
  marketplaceId: "ATVPDKIKX0DER",
};
function opts(overrides: Partial<AllocateSettlementOptions> = {}): AllocateSettlementOptions {
  return { ...scope, ...overrides };
}
const principal = (amount: string, sku: string, orderId: string, quantity = "") =>
  line({ transactionType: "Order", amountType: "ItemPrice", amountDescription: "Principal", amount, sku, orderId, quantity });
const otherFee = (amountDescription: string, amount: string) =>
  line({ transactionType: "other-transaction", amountType: "other-transaction", amountDescription, amount });

// ---------------------------------------------------------------------------

test("重复本金行被抑制：本金仍 200.00 而非 300.01", () => {
  const rows = parseSyntheticTsv([
    principal("200.00", "SKU-A", "ORD-1"),
    principal("100.01", "SKU-A", "ORD-1"), // 同 overlapKey 的重复本金行
  ]);
  const result = allocateSettlementToSku(rows, opts());
  assert.equal(result.reconciliation.total.principalTotal, "200.000000");
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].basisAmount, "200.000000");
  assert.equal(result.reconciliation.total.otherfee, "100.010000"); // 兜底差额 = 被抑制本金
  assert.deepEqual(result.dedupeEvidence.suppressedRowNumbers, [2]);
  assert.equal(result.dedupeEvidence.overlapGroups.length, 1);
  assert.equal(result.dedupeEvidence.overlapGroups[0].keptRowNumber, 1);
  assert.deepEqual(result.dedupeEvidence.overlapGroups[0].suppressedRowNumbers, [2]);
  assert.equal(result.dedupeEvidence.distinctOrderCount, 1); // COUNT(DISTINCT order_id) 只计一次
});

test("Order/Refund overlapKey 不同，且退款单列 refund 不冲减本金", () => {
  const rows = parseSyntheticTsv([
    principal("200.00", "SKU-A", "ORD-1"),
    line({ transactionType: "Refund", amountType: "ItemPrice", amountDescription: "Principal", amount: "-20.00", sku: "SKU-A", orderId: "ORD-1" }),
  ]);
  assert.notEqual(buildOverlapKey(rows[0], scope), buildOverlapKey(rows[1], scope));
  assert.notEqual(buildDedupeKey(rows[0], scope), buildDedupeKey(rows[1], scope));
  assert.equal(classifySettlementRow(rows[1]), "SKU_REFUND");
  const result = allocateSettlementToSku(rows, opts());
  assert.equal(result.reconciliation.total.principalTotal, "200.000000");
  assert.equal(result.reconciliation.total.refundTotal, "-20.000000");
  assert.equal(result.lines[0].basisAmount, "200.000000"); // 退款不冲减本金
  assert.equal(result.reconciliation.ok, true);
});

test("两种仓储费分别进 storageFee / longStorageFee 两个池，且不计入本金", () => {
  const storage = parseSyntheticTsv([otherFee("Storage Fee", "-5.00")])[0];
  const long = parseSyntheticTsv([otherFee("StorageRenewalBilling", "-2.00")])[0];
  assert.equal(classifySettlementRow(storage), "STORE_FEE");
  assert.equal(classifySettlementRow(long), "STORE_FEE");
  assert.equal(settlementFeePool(storage), "storageFee");
  assert.equal(settlementFeePool(long), "longStorageFee");
  const rows = parseSyntheticTsv([
    principal("200.00", "SKU-A", "ORD-1"),
    otherFee("Storage Fee", "-5.00"),
    otherFee("StorageRenewalBilling", "-2.00"),
  ]);
  const result = allocateSettlementToSku(rows, opts());
  assert.equal(result.reconciliation.allocationVsPool.pools.storageFee.poolTotal, "-5.000000");
  assert.equal(result.reconciliation.allocationVsPool.pools.longStorageFee.poolTotal, "-2.000000");
  assert.equal(result.reconciliation.allocationVsPool.pools.shopOtherFee.poolTotal, "0.000000");
  assert.equal(result.reconciliation.total.principalTotal, "200.000000"); // 费用行不进本金
  assert.equal(result.lines[0].shareStorageFee, "-5.000000");
  assert.equal(result.lines[0].shareLongStorageFee, "-2.000000");
});

test("8 类 Σ分摊 == 池总额，尾差为 0（正负费用都精确对账）", () => {
  const rows = parseSyntheticTsv([
    principal("100.00", "SKU-A", "ORD-1"),
    principal("100.00", "SKU-B", "ORD-2"),
    otherFee("Storage Fee", "-10.00"),
    otherFee("StorageRenewalBilling", "-8.00"),
    line({ transactionType: "ServiceFee", amountType: "Cost of Advertising", amountDescription: "TransactionTotalAmount", amount: "-6.00" }),
    line({ transactionType: "CouponRedemptionFee", amountType: "CouponRedemptionFee", amountDescription: "Coupon", amount: "-4.00" }),
    otherFee("Current Reserve Amount", "-12.00"),
    line({ transactionType: "other-transaction", amountType: "FBA Inventory Reimbursement", amountDescription: "REIMBURSED", amount: "2.00" }), // 正费用
    otherFee("DisposalComplete", "-3.00"),
    otherFee("Paid Services Fee", "-5.00"), // 其余 → otherfee 兜底
  ]);
  const result = allocateSettlementToSku(rows, opts());
  assert.equal(result.reconciliation.allocationVsPool.ok, true);
  for (const pool of FEE_POOL_KEYS) {
    assert.equal(result.reconciliation.allocationVsPool.pools[pool].difference, "0.000000", `${pool} 尾差应为 0`);
  }
  assert.ok(result.lines.every((l) => !l.isRemainderBearer)); // 尾差为 0 → 无承担者
  assert.equal(result.lines.find((l) => l.sku === "SKU-A")!.shareStorageFee, "-5.000000");
  assert.equal(result.lines.find((l) => l.sku === "SKU-B")!.shareStorageFee, "-5.000000");
  assert.equal(result.lines.find((l) => l.sku === "SKU-A")!.shareReimbursementFee, "1.000000");
  assert.equal(result.reconciliation.ok, true);
});

test("MAX_PRINCIPAL_SKU 尾差落在最大本金 SKU（对比 LARGEST_REMAINDER）", () => {
  const rows = parseSyntheticTsv([
    principal("4.00", "SKU-A", "ORD-1"),
    principal("2.00", "SKU-B", "ORD-2"),
    principal("1.00", "SKU-C", "ORD-3"),
    otherFee("Storage Fee", "-0.01"), // 10000 微单位，基数 7.00 → 尾差 1 微单位
  ]);
  const max = allocateSettlementToSku(rows, opts({ remainderPolicy: "MAX_PRINCIPAL_SKU" }));
  const largest = allocateSettlementToSku(rows, opts()); // 默认 LARGEST_REMAINDER
  const aMax = max.lines.find((l) => l.sku === "SKU-A")!;
  const cLargest = largest.lines.find((l) => l.sku === "SKU-C")!;
  // MAX_PRINCIPAL_SKU：整笔尾差归本金最大 SKU-A
  assert.equal(aMax.shareStorageFee, unitsAmount(BigInt(-5715)));
  assert.equal(aMax.isRemainderBearer, true);
  assert.equal(max.lines.find((l) => l.sku === "SKU-C")!.shareStorageFee, unitsAmount(BigInt(-1428)));
  assert.equal(max.lines.find((l) => l.sku === "SKU-C")!.isRemainderBearer, false);
  // LARGEST_REMAINDER：余数最大的 SKU-C 补 1 微单位
  assert.equal(cLargest.shareStorageFee, unitsAmount(BigInt(-1429)));
  assert.equal(cLargest.isRemainderBearer, true);
  assert.equal(largest.lines.find((l) => l.sku === "SKU-A")!.shareStorageFee, unitsAmount(BigInt(-5714)));
  assert.equal(max.reconciliation.allocationVsPool.ok, true);
  assert.equal(largest.reconciliation.allocationVsPool.ok, true);
});

test("本金全 0 时走 SALES 分支（销量占比）", () => {
  const rows = parseSyntheticTsv([
    principal("0.00", "SKU-A", "ORD-1", "2"),
    principal("0.00", "SKU-B", "ORD-2", "3"),
    otherFee("Storage Fee", "-10.00"),
  ]);
  const result = allocateSettlementToSku(rows, opts());
  assert.equal(result.header.basisType, "SALES");
  const a = result.lines.find((l) => l.sku === "SKU-A")!;
  const b = result.lines.find((l) => l.sku === "SKU-B")!;
  assert.equal(a.rate, "0.400000000000000000000000000000");
  assert.equal(a.basisAmount, "2.000000");
  assert.equal(a.shareStorageFee, "-4.000000");
  assert.equal(b.shareStorageFee, "-6.000000");
  assert.equal(result.reconciliation.ok, true);
});

test("本金/销量全 0 时走 NONE 分支，8 类全 0 且不除零", () => {
  const rows = parseSyntheticTsv([
    principal("0.00", "SKU-A", "ORD-1", "0"),
    principal("0.00", "SKU-B", "ORD-2", "0"),
  ]);
  const result = allocateSettlementToSku(rows, opts());
  assert.equal(result.header.basisType, "NONE");
  assert.equal(result.reconciliation.ok, true);
  const shareFields = [
    "shareStorageFee", "shareLongStorageFee", "shareAdvSpendFee", "shareCouponRedemptionFee",
    "shareReserveFee", "shareReimbursementFee", "shareDisposalFee", "shareShopOtherFee",
  ] as const;
  for (const l of result.lines) {
    for (const field of shareFields) assert.equal(l[field], "0.000000");
    assert.equal(l.rate, `0.${"0".repeat(30)}`);
  }
  assert.equal(result.reconciliation.total.difference, "0.000000");
});

test("总额对账失败（controlTotal 与 Σ原始行 不一致）整批抛错", () => {
  const rows = parseSyntheticTsv([
    principal("200.00", "SKU-A", "ORD-1"),
    otherFee("Storage Fee", "-10.00"),
  ]);
  assert.throws(
    () => allocateSettlementToSku(rows, opts({ controlTotal: "1.00" })),
    /对账失败/,
  );
});

test("非法十进制（7 位小数）整批被拒", () => {
  const rows = parseSyntheticTsv([principal("12.3456789", "SKU-A", "ORD-1")]);
  assert.throws(() => allocateSettlementToSku(rows, opts()));
});

test("跨币种（USD/EUR 混用）整批拒绝", () => {
  const rows = parseSyntheticTsv([
    line({ transactionType: "Order", amountType: "ItemPrice", amountDescription: "Principal", amount: "200.00", sku: "SKU-A", orderId: "ORD-1", currency: "USD" }),
    line({ transactionType: "Order", amountType: "ItemPrice", amountDescription: "Principal", amount: "100.00", sku: "SKU-B", orderId: "ORD-2", currency: "EUR" }),
  ]);
  assert.throws(() => allocateSettlementToSku(rows, opts()), /对账失败/);
});

test("inputDigest 稳定，且改 rowHash 会变化", () => {
  const rows = parseSyntheticTsv([
    principal("200.00", "SKU-A", "ORD-1"),
    otherFee("Storage Fee", "-10.00"),
  ]);
  const d1 = allocateSettlementToSku(rows, opts()).header.inputDigest;
  const d2 = allocateSettlementToSku(rows, opts()).header.inputDigest;
  assert.equal(d1, d2);
  const tampered = [...rows];
  tampered[0] = { ...tampered[0], rowHash: "tampered-row-hash" };
  const d3 = allocateSettlementToSku(tampered, opts()).header.inputDigest;
  assert.notEqual(d3, d1);
});

test("纯函数模块零 IO：源码 import 不含 DB/env/网络依赖，运行时不加载 .env", () => {
  const forbidden =
    /@\/lib\/db\/prisma|sp-api-client|data-access|processor|process\.env|\bfetch\(|dotenv|from ["']@prisma\/client/;
  for (const file of ["settlement-fee-classification.ts", "settlement-sku-allocation.ts"]) {
    const text = readFileSync(join(process.cwd(), "src", "lib", "amazon-sync", file), "utf8");
    const importLines = text.split("\n").filter((l) => /^\s*import\b/.test(l)).join("\n");
    assert.ok(!forbidden.test(importLines), `${file} 的 import 不得引入 DB/env/网络依赖`);
  }
  // 纯函数计算不依赖任何数据库/网络；仅用 node:crypto 生成确定性摘要。
  assert.equal(typeof allocateSettlementToSku, "function");
});
