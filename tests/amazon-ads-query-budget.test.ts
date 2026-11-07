import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdsQueryBudget } from "../src/lib/amazon-ads/query-budget";
test("Ads read budget limits each credential, bounds memory and expires windows", () => {
  const check = createAdsQueryBudget(2, 100, 2);
  check("a", 0); check("a", 1); assert.throws(() => check("a", 2), /频率超限/);
  check("b", 2); assert.throws(() => check("c", 3), /频率超限/);
  check("c", 101); check("a", 102);
});
