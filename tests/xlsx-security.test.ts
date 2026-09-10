import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

function versionAtLeast(version: string, minimum: [number, number, number]) {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  const current = [major, minor, patch];

  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] !== minimum[index]) {
      return current[index] > minimum[index];
    }
  }

  return true;
}

test("xlsx parser uses a release containing the known security fixes", () => {
  assert.ok(versionAtLeast(XLSX.version, [0, 20, 2]), `Unexpected xlsx version: ${XLSX.version}`);
});

test("xlsx parser keeps the basic workbook round-trip contract", () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["SKU", "Qty"],
    ["SMOKE-SKU", 2],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Smoke");

  const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const reopened = XLSX.read(output, { type: "array" });

  assert.deepEqual(reopened.SheetNames, ["Smoke"]);
  assert.equal(reopened.Sheets.Smoke.A2.v, "SMOKE-SKU");
  assert.equal(reopened.Sheets.Smoke.B2.v, 2);
});
