import assert from "node:assert/strict";
import test from "node:test";
import { estimateFbaStorage, estimateFreight } from "@/lib/logistics/freight-estimate";

const base = {
  quantity: "2", grossWeightKg: "1.25", lengthCm: "30", widthCm: "20", heightCm: "10",
  divisorCm3PerKg: "6000", ratePerKg: "8.5", currency: "CNY",
};

test("dimensional-weight mode charges the greater of gross and volumetric weight", () => {
  assert.deepEqual(estimateFreight({ ...base, mode: "DIMENSIONAL_WEIGHT" }), {
    actualWeightKg: "2.500", chargeableWeightKg: "2.500", estimatedFreight: "21.25", currency: "CNY",
  });
  assert.equal(estimateFreight({ ...base, grossWeightKg: "0.5", mode: "DIMENSIONAL_WEIGHT" }).chargeableWeightKg, "2.000");
});

test("volume mode does not substitute gross weight and rounds dimensional weight to four places", () => {
  const result = estimateFreight({ ...base, quantity: "1", grossWeightKg: "", lengthCm: "25", widthCm: "20", heightCm: "10", divisorCm3PerKg: "6000", ratePerKg: "7.25", mode: "VOLUME" });
  assert.equal(result.actualWeightKg, null);
  assert.equal(result.chargeableWeightKg, "0.833");
  assert.equal(result.estimatedFreight, "6.04");
});

test("weight mode uses quantity times actual weight and exact cent rounding", () => {
  const result = estimateFreight({ ...base, mode: "WEIGHT", ratePerKg: "0.335" });
  assert.equal(result.chargeableWeightKg, "2.500");
  assert.equal(result.estimatedFreight, "0.84");
});

test("invalid units, rates and precision are rejected", () => {
  assert.throws(() => estimateFreight({ ...base, mode: "DIMENSIONAL_WEIGHT", divisorCm3PerKg: "0" }), /必须大于 0/);
  assert.throws(() => estimateFreight({ ...base, mode: "WEIGHT", grossWeightKg: "" }), /需要填写单件毛重/);
  assert.throws(() => estimateFreight({ ...base, mode: "VOLUME", quantity: "1.5" }), /整数/);
  assert.throws(() => estimateFreight({ ...base, mode: "WEIGHT", currency: "US" }), /三位币种/);
});

test("FBA storage estimate converts cubic inches to cubic feet and multiplies monthly rate", () => {
  assert.deepEqual(estimateFbaStorage({
    lengthIn: "12", widthIn: "12", heightIn: "12", monthlyRatePerCubicFoot: "0.87", months: "3", currency: "usd",
  }), { volumeCubicFeet: "1.0000", estimatedFee: "2.610000", currency: "USD" });
});

test("FBA storage estimate rejects invalid month counts and currency", () => {
  const base = { lengthIn: "12", widthIn: "12", heightIn: "12", monthlyRatePerCubicFoot: "1", months: "1", currency: "USD" };
  assert.throws(() => estimateFbaStorage({ ...base, months: "1.5" }));
  assert.throws(() => estimateFbaStorage({ ...base, currency: "US" }));
});
