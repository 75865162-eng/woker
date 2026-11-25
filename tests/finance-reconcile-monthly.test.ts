import test from "node:test";
import assert from "node:assert/strict";
import { buildMonthlyReconcile, classifyCounterparty, ReconcileRuleError } from "../src/lib/finance/reconcile-monthly";

const periodOf = (item: { counterparty: string }) => item.counterparty.includes("11") ? "2026-11" : "2026-12";

test("buildMonthlyReconcile: 按往来方+账期+币种聚合，已付/未付正确", () => {
  const items = [
    { id: "o1", counterparty: "supplier:A", kind: "AP", currency: "CNY", amount: "100.000000", status: "OPEN" },
    { id: "o2", counterparty: "supplier:A", kind: "AP", currency: "CNY", amount: "50.000000", status: "OPEN" },
    { id: "o3", counterparty: "carrier:B", kind: "AP", currency: "CNY", amount: "30.000000", status: "OPEN" },
  ];
  const settlements = [
    { documentId: "o1", amount: "60.000000", reversedBy: null, date: "2026-11-20" },
    { documentId: "o2", amount: "50.000000", reversedBy: "rev-1", date: "2026-11-21" }, // 冲销 → 不计已付
  ];
  const out = buildMonthlyReconcile(items, settlements, () => "2026-11");
  assert.equal(out.length, 2); // supplier:A + carrier:B
  const supplier = out.find((r) => r.counterparty === "supplier:A")!;
  assert.equal(supplier.orderCount, 2);
  assert.equal(supplier.totalOrderAmount, "150.000000");
  assert.equal(supplier.totalPaid, "60.000000"); // o2 冲销不计
  assert.equal(supplier.totalUnpaid, "90.000000");
});

test("不跨币种相加：同往来方不同币种分列", () => {
  const items = [
    { id: "o1", counterparty: "supplier:A", kind: "AP", currency: "CNY", amount: "100", status: "OPEN" },
    { id: "o2", counterparty: "supplier:A", kind: "AP", currency: "USD", amount: "20", status: "OPEN" },
  ];
  const out = buildMonthlyReconcile(items, [], () => "2026-11");
  assert.equal(out.length, 2);
  assert.deepEqual(new Set(out.map((r) => r.currency)), new Set(["CNY", "USD"]));
});

test("账期归属由调用方提供，分组正确", () => {
  const items = [
    { id: "o1", counterparty: "supplier:11", kind: "AP", currency: "CNY", amount: "10", status: "OPEN" },
    { id: "o2", counterparty: "supplier:12", kind: "AP", currency: "CNY", amount: "20", status: "OPEN" },
  ];
  const out = buildMonthlyReconcile(items, [], periodOf);
  assert.deepEqual(out.map((r) => r.reconcileMonth), ["2026-11", "2026-12"]);
});

test("非法币种/账期拒绝", () => {
  assert.throws(() => buildMonthlyReconcile([
    { id: "o1", counterparty: "x", kind: "AP", currency: "cny", amount: "10", status: "OPEN" },
  ], [], () => "2026-11"), ReconcileRuleError);
  assert.throws(() => buildMonthlyReconcile([
    { id: "o1", counterparty: "x", kind: "AP", currency: "CNY", amount: "10", status: "OPEN" },
  ], [], () => "bad-period"), ReconcileRuleError);
});

test("空输入 → 空汇总", () => {
  assert.deepEqual(buildMonthlyReconcile([], [], () => "2026-11"), []);
});

test("classifyCounterparty 显式前缀归类，未标记归 unknown", () => {
  assert.equal(classifyCounterparty("supplier:A"), "supplier");
  assert.equal(classifyCounterparty("carrier:B"), "carrier");
  assert.equal(classifyCounterparty("随机客户"), "unknown");
});
