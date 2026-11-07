import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { readWorkbookXmlElements, removeWorkbookXmlElements } from "@/lib/excel/bulk-workbook-xml";
import { exportSelectedDrafts, validateBulkExport } from "@/lib/excel/bulk-export";
import type { AdjustmentDraft } from "@/lib/types";

test("metadata parser handles namespaces, entities, Unicode and exact span removal", () => {
  const xml = `<?xml version="1.0"?><m:workbook xmlns:m="urn:fixture" xmlns:r="urn:relationships"><!--keep--><m:sheets><m:sheet name='A &amp; B&#x1F600;' r:id='rId2'/><m:sheet name="keep" r:id="rId3"></m:sheet></m:sheets></m:workbook>`;
  const entries = readWorkbookXmlElements(xml, "sheet");
  assert.equal(entries.length, 2);
  assert.equal(entries[0].attributes.name, "A & B😀");
  assert.equal(removeWorkbookXmlElements(xml, [entries[0]]), xml.replace("<m:sheet name='A &amp; B&#x1F600;' r:id='rId2'/>", ""));
  assert.throws(() => readWorkbookXmlElements('<!DOCTYPE x SYSTEM "https://fixture.invalid"><x/>', "x"), /DOCTYPE/);
  assert.throws(() => readWorkbookXmlElements("<root><sheet></root>", "sheet"));
});

async function fixture() {
  const workbook = XLSX.utils.book_new();
  const name = "Fixture & 中文 😀";
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Entity", "Operation", "Campaign ID", "Ad Group ID", "Keyword ID", "Bid", "State", "Keyword Text"],
    ["Keyword", "", "campaign-1", "group-1", "keyword-1", 0.5, "enabled", "fixture keyword"],
  ]), name);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["untouched"], ["fixture"]]), "Control");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["exclude"], ["fixture"]]), "RAS Search Term Report");
  const zip = await JSZip.loadAsync(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  zip.file("xl/worksheets/odd.xml", sheet); zip.remove("xl/worksheets/sheet1.xml");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  zip.file("xl/_rels/workbook.xml.rels", rels.replace('Target="worksheets/sheet1.xml"', 'Target="/xl/worksheets/odd.xml"'));
  zip.file("customXml/fixture.xml", "<fixture untouched='yes'/>");
  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  const draft = { id:"fixture-draft",campaignGroupId:"group",rowId:"keyword-1",sheetName:name,sourceRowIndex:2,field:"bid",oldValue:0.5,newValue:0.4,keyword:"fixture",target:"fixture",currentBid:0.5,suggestedBid:0.4,deltaPercent:-20,reason:"regression",matchedRule:"fixture",selected:true } as AdjustmentDraft;
  return { buffer, draft, zip };
}
test("Node export preserves original and unknown parts, edits only bid/operation, excludes RAS", async () => {
  assert.equal(typeof DOMParser, "undefined", "no browser polyfill in fixture");
  const { buffer, draft, zip } = await fixture();
  const original = Buffer.from(buffer).toString("base64");
  const result = await exportSelectedDrafts({ workbookBuffer: buffer, drafts: [draft] });
  assert.equal(result.writableCount, 1);
  assert.equal(validateBulkExport(buffer, result.data).valid, true);
  const output = XLSX.read(result.data, { type: "array" }), row = output.Sheets[draft.sheetName!];
  assert.equal(row.F2.v, 0.4); assert.equal(row.B2.v, "Update"); assert.equal(row.C2.v, "campaign-1");
  assert.equal(row.G2.v, "enabled"); assert.ok(!output.SheetNames.includes("RAS Search Term Report"));
  const changed = await JSZip.loadAsync(result.data);
  for (const key of ["xl/worksheets/sheet2.xml", "customXml/fixture.xml"]) {
    assert.equal(await changed.file(key)!.async("string"), await zip.file(key)!.async("string"));
  }
  assert.equal(changed.file("xl/worksheets/sheet3.xml"), null);
  assert.equal(Buffer.from(buffer).toString("base64"), original);
});
test("stale and unchecked drafts cannot alter the bid", async () => {
  const { buffer, draft } = await fixture();
  for (const next of [{ ...draft, oldValue: 999 }, { ...draft, selected: false }]) {
    const result = await exportSelectedDrafts({ workbookBuffer: buffer, drafts: [next] });
    assert.equal(result.writableCount, 0);
    assert.equal(XLSX.read(result.data, { type: "array" }).Sheets[draft.sheetName!].F2.v, 0.5);
  }
});
