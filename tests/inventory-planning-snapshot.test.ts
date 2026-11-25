import test from "node:test";
import assert from "node:assert/strict";
import {
  parseInventoryPlanningRow, planningCoverageMeets, INVENTORY_PLANNING_FIELDS, InventoryPlanningError,
} from "../src/lib/amazon-sync/inventory-planning-snapshot";

test("字段清单正好 53 列，覆盖 5+5 库龄/AIS、动销、健康、推荐动作", () => {
  assert.equal(INVENTORY_PLANNING_FIELDS.length, 53);
  const groups = new Set(INVENTORY_PLANNING_FIELDS.map(f => f.group));
  assert.deepEqual([...groups].sort(), ["ACTION", "AGE_BUCKET", "AIS_BUCKET", "HEALTH", "OTHER", "SKU_ID", "VELOCITY"]);
});

test("解析 53 列规划行：多别名归一化命中 + 保真", () => {
  const raw = {
    "SellerSKU": "SKU-1", "ASIN": "B0XXX", "age0to30": "10", "salesShippedLast7Days": "42",
    "health-status": "YELLOW", "RecommendedAction": "RESTOCK", "price": "19.99",
  };
  const snap = parseInventoryPlanningRow(raw);
  assert.equal(snap.values["seller-sku"], "SKU-1");
  assert.equal(snap.values["age-0-30"], "10");
  assert.equal(snap.values["units-shipped-t7"], "42");
  assert.equal(snap.values["recommended-action"], "RESTOCK");
  assert.equal(snap.values["asin"], "B0XXX");
});

test("缺值不补零：缺失字段为 null 并显式列入 missing", () => {
  const snap = parseInventoryPlanningRow({ "SellerSKU": "SKU-1" });
  assert.equal(snap.values["seller-sku"], "SKU-1");
  assert.equal(snap.values["age-0-30"], null);
  assert.ok(snap.missing.includes("age-0-30"));
  assert.equal(snap.captured.length, 1);
});

test("覆盖率与分组覆盖率可审计", () => {
  const raw = {
    "SellerSKU": "SKU-1", "ASIN": "B0X", "FNSKU": "X", "Condition": "New", "WarehouseCode": "PHX3",
    "age0to30": "1", "age31to60": "2", "age61to90": "3", "age91to180": "4", "age181to365": "5",
  };
  const snap = parseInventoryPlanningRow(raw);
  assert.equal(snap.captured.length, 10);
  assert.equal(snap.coverage, 10 / 53);
  assert.equal(snap.groupCoverage.SKU_ID.captured, 5);
  assert.equal(snap.groupCoverage.SKU_ID.ratio, 1);
  assert.equal(snap.groupCoverage.AGE_BUCKET.captured, 5);
});

test("覆盖率达标判定（≥90%）与阈值校验", () => {
  const full: Record<string, string> = {};
  for (const spec of INVENTORY_PLANNING_FIELDS) full[spec.canonical] = "1";
  assert.equal(planningCoverageMeets(parseInventoryPlanningRow(full)), true);
  assert.equal(planningCoverageMeets(parseInventoryPlanningRow({ "SellerSKU": "x" })), false);
  assert.throws(() => planningCoverageMeets(parseInventoryPlanningRow(full), 1.5), InventoryPlanningError);
});

test("空输入：全字段 null，覆盖率 0，不臆造", () => {
  const snap = parseInventoryPlanningRow(null);
  assert.equal(snap.coverage, 0);
  assert.equal(snap.captured.length, 0);
  assert.equal(snap.missing.length, 53);
});
