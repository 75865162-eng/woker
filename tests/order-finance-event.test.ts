import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFinanceEvent, financeEventEconomicKey, buildOrderFinanceEventRow, dedupeFinanceEvents,
  businessLinkKey, orderRowLookupKey, reportRowLookupKey, OrderFinanceEventError,
  type FinanceEventIdentity,
} from "../src/lib/amazon-sync/order-finance-event";

const scope = { organizationId: "o1", workspaceId: "w1" };
const evt = (over: Partial<FinanceEventIdentity> = {}): FinanceEventIdentity => ({
  ...scope, amazonOrderId: "ORDER-1", orderItemId: "ITEM-1", sku: "SKU-A",
  eventType: "RefundEvent", currency: "USD", postedDate: "2026-11-20",
  sourceRunId: "run-9", ...over,
});

test("财务事件分类：已知别名 → 标准类型；未识别 → UNKNOWN（不猜测）", () => {
  assert.equal(classifyFinanceEvent("RefundEvent"), "REFUND");
  assert.equal(classifyFinanceEvent("order-charge"), "ORDER_CHARGE");
  assert.equal(classifyFinanceEvent("FBA Fee"), "FBA_FEE");
  assert.equal(classifyFinanceEvent("mystery-event"), "UNKNOWN");
  assert.equal(classifyFinanceEvent(""), "UNKNOWN");
});

test("经济键：订单+行+类型+币种+发布日确定性唯一；空值用 * 占位", () => {
  const k1 = financeEventEconomicKey(evt());
  assert.equal(k1, "o1|w1|ORDER-1|ITEM-1|SKU-A|REFUND|2026-11-20|USD");
  assert.equal(financeEventEconomicKey(evt()), k1, "同输入确定性一致");
  assert.notEqual(financeEventEconomicKey(evt({ postedDate: "2026-11-21" })), k1);
  assert.match(financeEventEconomicKey(evt({ orderItemId: null })), /\|\*\|/);
});

test("经济键缺订单/事件类型/币种被拒绝", () => {
  assert.throws(() => financeEventEconomicKey(evt({ amazonOrderId: "" })), OrderFinanceEventError);
  assert.throws(() => financeEventEconomicKey(evt({ eventType: "" })), OrderFinanceEventError);
  assert.throws(() => financeEventEconomicKey(evt({ currency: "" })), OrderFinanceEventError);
});

test("构建事件行：ftype 标准化 + 金额校验", () => {
  const row = buildOrderFinanceEventRow(evt(), "-12.340000");
  assert.equal(row.ftype, "REFUND");
  assert.equal(row.amount, "-12.340000");
  assert.equal(row.economicKey, financeEventEconomicKey(evt()));
  assert.throws(() => buildOrderFinanceEventRow(evt(), "abc"), OrderFinanceEventError);
});

test("去重：重复经济键被显式计数，不静默覆盖", () => {
  const r1 = buildOrderFinanceEventRow(evt(), "1.000000");
  const r2 = buildOrderFinanceEventRow(evt(), "999.000000"); // 同键不同金额
  const r3 = buildOrderFinanceEventRow(evt({ postedDate: "2026-11-21" }), "2.000000");
  const { kept, duplicates } = dedupeFinanceEvents([r1, r2, r3]);
  assert.equal(kept.length, 2);
  assert.equal(duplicates, 1);
  assert.equal(kept[0].amount, "1.000000", "保留首次出现，不被重复覆盖");
});

test("链路主键：业务链路键 + 订单行反查键 + 原始报告行反查键", () => {
  const link = businessLinkKey({ ...scope, downstreamKind: "RETURN", downstreamId: "RET-77" });
  assert.equal(link, "bizlink|o1|w1|RETURN|RET-77");
  const order = { ...scope, amazonOrderId: "ORDER-1", orderItemId: "ITEM-1", marketplaceId: "ATVPDKIKX0DER",
    sourceRunId: "run-9", reportType: "GET_FLAT_FILE_ALL_ORDERS", rowNumber: 12 };
  assert.equal(orderRowLookupKey(order), "o1|w1|ORDER-1|ITEM-1|ATVPDKIKX0DER");
  assert.equal(reportRowLookupKey(order), "run-9|GET_FLAT_FILE_ALL_ORDERS|12");
  assert.equal(reportRowLookupKey({ ...scope, amazonOrderId: "x" }), "*|*|*", "缺失显式占位，不静默补值");
});

test("未知下游类型被拒绝", () => {
  assert.throws(() => businessLinkKey({ ...scope, downstreamKind: "BOGUS" as never, downstreamId: "x" }), OrderFinanceEventError);
});
