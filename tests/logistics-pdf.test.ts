import assert from "node:assert/strict";
import test from "node:test";

import { parsePdfBuffer } from "@/lib/logistics/pdf";

function textToArrayBuffer(text: string) {
  const buffer = Buffer.from(text, "binary");
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

test("logistics PDF parser prefers real warehouse codes over internal UCS2 encoding names", async () => {
  const summary = await parsePdfBuffer(
    textToArrayBuffer("%PDF-1.4\n/Count 7\n/UCS2\n/FBA STA (09/04/2026 05:27)-MDW2 Created:\n(FBA19NV9PY97U000001) Tj\n%%EOF"),
    "FBA19NV9PY97-1788499710869.pdf",
  );

  assert.equal(summary.warehouseCode, "MDW2");
  assert.equal(summary.fbaCode, "FBA19NV9PY97");
  assert.equal(summary.renamedFileName, "MDW2-FBA19NV9PY97-7箱.pdf");
  assert.equal(summary.totalBoxes, 7);
});
