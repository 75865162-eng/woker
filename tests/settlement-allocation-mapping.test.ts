/**
 * 结算行 DB → 分摊算法归一化的隔离单测。
 * 纯内存，不 import prisma / .env / SP-API，不发网络请求。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  settlementStringFields,
  settlementQuantity,
  rowSettlementId,
  rowMarketplaceId,
  toNormalizedSettlementRows,
  assertBatchIdentity,
  type StoredSettlementRow,
} from "@/lib/amazon-sync/settlement-allocation-mapping";

function row(overrides: Partial<StoredSettlementRow> = {}): StoredSettlementRow {
  return {
    rowNumber: 1,
    rowHash: "hash-1",
    businessDateRaw: "2026-10-01",
    businessDate: "2026-10-01",
    orderId: "111-222",
    sellerSku: "SKU-A",
    asin: "B000000001",
    amountOriginal: "100.00",
    currencyCode: "USD",
    currencySource: "row",
    currencySourceRowNumber: 1,
    transactionType: "Order",
    amountType: "ItemPrice",
    amountDescription: "Principal",
    marketplaceId: "ATVPDKIKX0DER",
    fields: {
      "settlement-id": "S-1",
      "marketplace-id": "ATVPDKIKX0DER",
      "quantity-purchased": "2",
    },
    ...overrides,
  };
}

test("settlementStringFields 只保留可判定为字符串语义的标量", () => {
  assert.deepEqual(
    settlementStringFields({ a: "x", b: 3, c: true, d: null, e: { nested: 1 }, f: [1], g: undefined }),
    { a: "x", b: "3", c: "true" },
  );
  assert.deepEqual(settlementStringFields(null), {});
  assert.deepEqual(settlementStringFields([1, 2]), {});
  assert.deepEqual(settlementStringFields("text"), {});
});

test("quantity 恢复顺序与 domain-reports.ts 对 settlements 的优先级一致", () => {
  assert.equal(settlementQuantity({ "quantity-shipped": "5", quantity: "3" }), "5");
  assert.equal(settlementQuantity({ quantity: "3", "quantity-purchased": "2" }), "3");
  assert.equal(settlementQuantity({ "quantity-purchased": "2", "quantity-reimbursed-total": "1" }), "2");
  assert.equal(settlementQuantity({ "quantity-reimbursed-total": "1" }), "1");
  assert.equal(settlementQuantity({ quantity: "  " }), null);
  assert.equal(settlementQuantity({}), null);
  assert.equal(rowSettlementId({ "settlement-id": " S-9 " }), "S-9");
  assert.equal(rowMarketplaceId({ "marketplace-id": "ATVPDKIKX0DER" }), "ATVPDKIKX0DER");
});

test("toNormalizedSettlementRows 全量保留行并恢复 quantityOriginal", () => {
  const rows = [
    row({ rowNumber: 1, fields: { "settlement-id": "S-1", "quantity-purchased": "2" } }),
    row({ rowNumber: 2, rowHash: "hash-2", sellerSku: null, amountOriginal: "-3.50", fields: { "settlement-id": "S-1", "amount-description": "Storage Fee" } }),
  ];
  const result = toNormalizedSettlementRows(rows);
  assert.equal(result.length, 2);
  assert.equal(result[0].quantityOriginal, "2");
  assert.equal(result[1].quantityOriginal, null);
  assert.equal(result[1].sellerSku, null);
  assert.equal(result[1].amountOriginal, "-3.50");
  assert.equal(result[0].rowHash, "hash-1");
  assert.equal(result[1].rowHash, "hash-2");
  assert.equal(result[0].currencySourceRowNumber, 1);
  assert.equal(result[0].fields["settlement-id"], "S-1");
  // 不丢行、不改金额：对账完整性依赖全量输入
  assert.deepEqual(result.map(item => item.rowNumber), [1, 2]);
});

test("assertBatchIdentity 接受同结算/站点/币种的一致批次", () => {
  const rows = [row(), row({ rowNumber: 2, rowHash: "hash-2", amountOriginal: "-1.00" })];
  assert.doesNotThrow(() => assertBatchIdentity(rows, { settlementId: "S-1", currency: "USD", marketplaceId: "ATVPDKIKX0DER" }));
});

test("assertBatchIdentity 对混批整批拒绝，不静默过滤", () => {
  const identity = { settlementId: "S-1", currency: "USD", marketplaceId: "ATVPDKIKX0DER" };
  const cases: Array<[string, Partial<StoredSettlementRow>]> = [
    ["跨结算号", { fields: { "settlement-id": "S-2" } }],
    ["缺少结算号", { fields: {} }],
    ["跨币种", { currencyCode: "EUR" }],
    ["缺币种", { currencyCode: null }],
    ["跨站点", { marketplaceId: "A1PA6795UKMFR9" }],
    ["缺 rowHash", { rowHash: "" }],
    ["缺金额", { amountOriginal: null }],
  ];
  for (const [label, override] of cases) {
    assert.throws(() => assertBatchIdentity([row(override)], identity), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /第 1 行|没有可分摊/);
      return true;
    }, label);
  }
  assert.throws(() => assertBatchIdentity([], identity), /没有可分摊/);
});

test("站点归属可从 fields 兜底，但与显式列冲突时以显式列为准", () => {
  const identity = { settlementId: "S-1", currency: "USD", marketplaceId: "ATVPDKIKX0DER" };
  assert.doesNotThrow(() => assertBatchIdentity(
    [row({ marketplaceId: null, fields: { "settlement-id": "S-1", "marketplace-id": "ATVPDKIKX0DER" } })], identity,
  ));
  assert.throws(() => assertBatchIdentity(
    [row({ marketplaceId: "A1PA6795UKMFR9", fields: { "settlement-id": "S-1", "marketplace-id": "ATVPDKIKX0DER" } })], identity,
  ), /站点归属/);
});
