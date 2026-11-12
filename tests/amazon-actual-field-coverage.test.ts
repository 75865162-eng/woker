import assert from "node:assert/strict";
import test from "node:test";
import { summarizePersistenceChecks } from "../src/lib/amazon-sync/actual-field-coverage";
const check = { fieldRegistryId: "field", mappingId: "mapping", reportDocumentId: "document", batchDigest: "batch", checkedRows: 5 };
test("actual evidence coverage uses latest per exact batch and never sums checks as distinct rows", () => {
  const result = summarizePersistenceChecks([{ metadata: { ...check, status: "FAILED" } }, { metadata: { ...check, status: "PASSED" } },
    { metadata: { ...check, mappingId: "old-mapping", status: "PASSED" } }], false);
  assert.equal(result.distinctBatchFieldChecks, 2); assert.equal(result.passedChecks, 1); assert.equal(result.failedChecks, 1);
  assert.equal(result.checkedRowOccurrences, 10); assert.equal(result.distinctVerifiedBusinessRows, null); assert.equal(result.fullFieldAcceptance, false);
});
test("actual evidence coverage keeps truncation and empty or malformed history explicit", () => {
  assert.equal(summarizePersistenceChecks([], false).fieldsWithPassedBatch, 0);
  const result = summarizePersistenceChecks([{ metadata: null }, { metadata: { status: "PASSED" } }], true);
  assert.equal(result.distinctBatchFieldChecks, 0); assert.equal(result.evidenceTruncated, true); assert.equal(result.fullFieldAcceptance, false);
});
