import assert from "node:assert/strict";
import test from "node:test";
import { isProductStatus, productStatusValues } from "@/lib/products/status-catalog";
import {
  assertProductStatusTransition,
  assertProductStatusTransitionWithOptions,
  canTransitionProductStatus,
  InvalidProductStatusError,
} from "@/lib/products/status-machine";

test("product status catalog is explicit and rejects derived filters", () => {
  assert.equal(productStatusValues.length, 9);
  assert.equal(isProductStatus("developing"), true);
  assert.equal(isProductStatus("overdue"), false);
  assert.equal(isProductStatus("operations_progress"), false);
  assert.equal(isProductStatus("unknown"), false);
});

test("product status machine allows forward workflow and rejects terminal rollback", () => {
  assert.equal(canTransitionProductStatus("pending", "developing"), true);
  assert.equal(canTransitionProductStatus("developing", "design_in_progress"), false);
  assert.equal(canTransitionProductStatus("listed", "developing"), false);
  assert.equal(canTransitionProductStatus("delisted", "developing"), true);
  assert.throws(
    () => assertProductStatusTransition("listed", "developing"),
    (error) => error instanceof InvalidProductStatusError,
  );
});

test("version restore can explicitly restore a known historical status", () => {
  assert.doesNotThrow(() =>
    assertProductStatusTransitionWithOptions("listed", "developing", { allowRollback: true }),
  );
  assert.throws(
    () => assertProductStatusTransitionWithOptions("listed", "unknown", { allowRollback: true }),
    (error) => error instanceof InvalidProductStatusError,
  );
});
