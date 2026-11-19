import test from "node:test";
import assert from "node:assert/strict";
import {
  SELLFOX_FILTER_VALUES_MAX,
  SELLFOX_FILTER_FIELDS,
  parseSellfoxPastedValues,
  normalizeSellfoxCondition,
  resolveSellfoxFilterField,
  SellfoxFilterError,
} from "@/lib/sellfox/sellfox-filter-model";

test("批量粘贴：按逗号/分号/换行/空格切分，修剪、去空、去重、保序", () => {
  assert.deepEqual(parseSellfoxPastedValues(" B0A, B0A ;B0B\nB0C\tB0B "), ["B0A", "B0B", "B0C"]);
  assert.deepEqual(parseSellfoxPastedValues("  , ; \n "), []);
  assert.deepEqual(parseSellfoxPastedValues(null), []);
  assert.deepEqual(parseSellfoxPastedValues("单独"), ["单独"]);
});

test("批量粘贴超限抛错，不静默丢弃", () => {
  const many = Array.from({ length: SELLFOX_FILTER_VALUES_MAX + 1 }, (_, i) => `V${i}`).join(",");
  assert.throws(() => parseSellfoxPastedValues(many), (err: unknown) => {
    assert.ok(err instanceof SellfoxFilterError);
    assert.match(err.message, /最多粘贴/);
    return true;
  });
  const exactly = Array.from({ length: SELLFOX_FILTER_VALUES_MAX }, (_, i) => `V${i}`).join(",");
  assert.equal(parseSellfoxPastedValues(exactly).length, SELLFOX_FILTER_VALUES_MAX);
});

test("白名单：允许的 field 解析出真实 column，非法 field 返回 null", () => {
  assert.deepEqual(resolveSellfoxFilterField("sales", "store"), { column: "storeId", type: "text", ops: ["eq", "in"] });
  assert.equal(resolveSellfoxFilterField("sales", "storeId"), null); // 前端裸列名被拒
  assert.equal(resolveSellfoxFilterField("sales", "payload"), null);
  assert.equal(resolveSellfoxFilterField("unknownDomain", "asin"), null);
});

test("normalize 条件：合法字段/操作符通过，values 规范化", () => {
  const c = normalizeSellfoxCondition("sales", { field: " msku ", op: "in", values: "X, Y, X" });
  assert.deepEqual(c, { field: "msku", op: "in", values: ["X", "Y"] });
  const c2 = normalizeSellfoxCondition("listings", { field: "brand", op: "contains", values: ["Nike"] });
  assert.deepEqual(c2, { field: "brand", op: "contains", values: ["Nike"] });
});

test("normalize 条件：非法 field/op/空值被拒，不泄漏裸列名", () => {
  assert.throws(() => normalizeSellfoxCondition("sales", { field: "payload", op: "eq", values: "x" }), SellfoxFilterError);
  assert.throws(() => normalizeSellfoxCondition("sales", { field: "asin", op: "between", values: "x" }), SellfoxFilterError); // asin 不允许 between
  assert.throws(() => normalizeSellfoxCondition("sales", { field: "asin", op: "eq", values: "" }), SellfoxFilterError);
  assert.throws(() => normalizeSellfoxCondition("sales", { field: "", op: "eq", values: "x" }), SellfoxFilterError);
});

test("白名单字段只映射到已存在 typed 字段，不含猜测/金额加工字段", () => {
  for (const [domain, fields] of Object.entries(SELLFOX_FILTER_FIELDS)) {
    for (const [field, spec] of Object.entries(fields)) {
      assert.ok(spec.column && typeof spec.column === "string", `${domain}.${field} 必须有 column`);
      assert.ok(["text", "number", "date", "enum"].includes(spec.type));
      assert.ok(spec.ops.length > 0);
      // 白名单不得暴露 payload / 计算列 / 猜测字段
      assert.ok(!/payload|grossProfit|NEEDS_DATA/i.test(spec.column), `${domain}.${field} column 应为已存在 typed 字段`);
    }
  }
});
