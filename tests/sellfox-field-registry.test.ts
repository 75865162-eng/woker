import test from "node:test";
import assert from "node:assert/strict";
import {
  SELLFOX_FIELD_CONTRACTS, SELLFOX_FIELDS, sellfoxField,
  type FieldContract,
} from "@/lib/sellfox/field-registry";

test("每个字段契约都有来源、聚合、空值语义，键唯一且与扁平表一致", () => {
  const keys = SELLFOX_FIELD_CONTRACTS.map((field) => field.key);
  assert.equal(new Set(keys).size, keys.length, "字段键必须唯一");
  for (const field of SELLFOX_FIELD_CONTRACTS) {
    assert.ok(field.label && field.group && field.source && field.aggregate, `${field.key} 缺少基本元数据`);
    assert.ok(typeof field.nullSemantics === "string" && field.nullSemantics.length > 0, `${field.key} 缺少空值语义`);
    assert.equal(SELLFOX_FIELDS[field.key], field, `${field.key} 扁平表与列表不一致`);
    assert.equal(sellfoxField(field.key), field);
  }
  assert.equal(sellfoxField("__not_exist__"), undefined);
});

test("铁律1 不造数：needsData 必须 enabled=false 且无真实表列；none 源不得有表列", () => {
  for (const field of SELLFOX_FIELD_CONTRACTS) {
    if (field.needsData) {
      assert.equal(field.enabled, false, `${field.key} 标记 NEEDS_DATA 却启用`);
      assert.equal(field.table, null, `${field.key} NEEDS_DATA 却声明了表`);
      assert.equal(field.column, null, `${field.key} NEEDS_DATA 却声明了列`);
      assert.ok(field.reason, `${field.key} NEEDS_DATA 必须写原因`);
    }
    if (field.source === "none") {
      assert.equal(field.enabled, false, `${field.key} 无数据源却启用`);
    }
  }
});

test("铁律2 null 传播：空值语义只能是 '-' 或明确占位文案，禁止写成 0/零造数", () => {
  const allowed = new Set(["-", "未分配开发员", "未分配SPU"]);
  for (const field of SELLFOX_FIELD_CONTRACTS) {
    assert.ok(allowed.has(field.nullSemantics), `${field.key} 空值语义非法: ${field.nullSemantics}`);
    assert.ok(!/^0+$/.test(field.nullSemantics), `${field.key} 把空值补成了 0`);
  }
});

test("铁律3 币种不混算：金额字段必须标 currencyScoped", () => {
  const moneyKeys = ["mskuPrice", "revenue", "subtotal"];
  for (const key of moneyKeys) {
    assert.equal(sellfoxField(key)?.currencyScoped, true, `${key} 金额字段未标 currencyScoped`);
  }
});

test("铁律4 筛选即围栏：所有维度与 sales 聚合字段都标 scoped", () => {
  const mustScope = SELLFOX_FIELD_CONTRACTS.filter(
    (field) => field.group === "dimension" || (field.group === "sales" && field.aggregate === "sum"),
  );
  for (const field of mustScope) {
    assert.equal(field.scoped, true, `${field.key} 参与筛选/聚合却未标 scoped`);
  }
});

test("铁律5 同上下文下钻：行内动作登记为 route/NEEDS_DATA，不伪装成数据列", () => {
  for (const field of SELLFOX_FIELD_CONTRACTS.filter((f) => f.group === "action")) {
    assert.equal(field.source, "route", `${field.key} 动作未标 route`);
    assert.equal(field.enabled, false);
    assert.ok(field.reason?.includes("筛选"), `${field.key} 跳转原因未写明携带筛选`);
  }
});

test("真实落点：维度/业务员/库存/聚合都指向当前 schema 存在的表列", () => {
  const expect = (key: string, source: string, table: string | null, column: string) => {
    const field = sellfoxField(key);
    assert.ok(field, `缺少字段 ${key}`);
    assert.equal(field!.source, source, `${key} 来源不符`);
    assert.equal(field!.table, table, `${key} 表不符`);
    assert.equal(field!.column, column, `${key} 列不符`);
  };
  expect("asin", "sales_daily", "SellfoxSalesDailySnapshot", "asin");
  expect("parentAsin", "listing", "sellfox_listing_current", "parentAsin");
  expect("spu", "listing", "sellfox_listing_current", "spu");
  expect("developer", "listing", "sellfox_listing_current", "developer");
  expect("developer", "listing", "sellfox_listing_current", "developer");
  // 业务员是商品级数组属性，不是销量日快照的列——防止未来有人误加成 sales 列。
  const salesperson: FieldContract = sellfoxField("salesperson")!;
  assert.equal(salesperson.source, "product_daily");
  assert.equal(salesperson.table, "SellfoxProductDailySnapshot");
  assert.equal(salesperson.column, "userNameList");
  // FBA 库存字段均来自真实快照列。
  expect("fulfillable", "inventory", "SellfoxFbaInventorySnapshot", "quantity");
  expect("inTransit", "inventory", "SellfoxFbaInventorySnapshot", "inTransit");
  expect("inboundReceiving", "inventory", "SellfoxFbaInventorySnapshot", "inboundReceiving");
});

test("业务员不作可切维度、不从开发员冒充：enabled=false 且 reason 说明半连接", () => {
  const sp: FieldContract = sellfoxField("salesperson")!;
  assert.equal(sp.enabled, false);
  assert.ok(sp.reason?.includes("数组"));
  assert.ok(sp.reason?.includes("开发员"));
  assert.ok(sp.reason?.includes("半连接"));
});

test("未接入字段一律显示 '-' 且列出缺口原因，不补零不造列", () => {
  const needsData = SELLFOX_FIELD_CONTRACTS.filter((f) => f.needsData);
  assert.ok(needsData.length > 0);
  for (const field of needsData) {
    assert.equal(field.nullSemantics, "-", `${field.key} 缺口字段未用 '-' 语义`);
    assert.ok(field.reason && field.reason.length > 4, `${field.key} 缺口原因过短`);
  }
  for (const key of ["productName", "model", "owner", "category", "fbmAvailable", "awdInventory", "awdInTransit", "awdAvailable", "awdReserved", "awdToFba"]) {
    assert.equal(sellfoxField(key)?.needsData, true, `${key} 未被标为 NEEDS_DATA`);
  }
});
