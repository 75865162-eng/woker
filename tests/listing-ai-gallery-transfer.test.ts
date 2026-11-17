import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ExcelJS from "exceljs";
import { useGalleryExcelTransfer } from "../src/components/listing-ai/use-gallery-excel-transfer";
import { createEmptyCompetitor, initialInput, type CompetitorDraft, type GalleryCellStyle, type OwnImageDraft } from "../src/lib/listing-ai/workspace-draft";

test("画廊真实 Excel 往返保留文字样式图片，原草稿及输入工作簿不被修改", async () => {
  const descriptors = new Map(["document", "XMLHttpRequest", "FileReader"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let exported: Blob | undefined;
  let uploaded = 0;
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
  URL.createObjectURL = (blob) => { assert.ok(blob instanceof Blob); exported = blob; return "blob:fixture"; };
  URL.revokeObjectURL = () => {};
  Object.defineProperty(globalThis, "document", { configurable: true, value: { body: { append() {} }, createElement: () => ({ click() {}, remove() {}, href: "", download: "" }) } });
  class FixtureRequest {
    status = 200;
    responseType = "";
    responseText = "";
    upload = {};
    onload?: () => void;
    open(method: string, url: string) { assert.equal(method, "POST"); assert.equal(url, "/api/assets/upload"); }
    send(data: FormData) {
      assert.ok(data.get("file") instanceof Blob);
      this.responseText = JSON.stringify({ asset: { id: `assets/fixture-${++uploaded}`, url: "/fixture", name: "fixture.png", type: "image/png", size: 1, createdAt: "fixture" } });
      this.onload?.();
    }
  }
  class FixtureReader {
    result = "";
    onload?: () => void;
    readAsDataURL(blob: Blob) { void blob.arrayBuffer().then((buffer) => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`; this.onload?.(); }); }
  }
  Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: FixtureRequest });
  Object.defineProperty(globalThis, "FileReader", { configurable: true, value: FixtureReader });
  const competitor = { ...createEmptyCompetitor(), asin: "COMPETITOR-ASIN", aplus: "竞品 A+", images: [{ name: "original.png", url: dataUrl }] };
  const competitors = [competitor];
  const ownImages: OwnImageDraft = { structureNotes: "", mainImage: [], images: [], imageNotes: ["原图片备注"], sales: "", price: "", rating: "", reviewCount: "" };
  const input = { ...initialInput, asin: "MINE-ASIN", aplusRequirements: "自身 A+" };
  const cellStyles: Record<string, GalleryCellStyle> = {};
  const originals = structuredClone({ competitors, ownImages, input, cellStyles });
  let importedCompetitors: CompetitorDraft[] | undefined;
  let importedOwn: OwnImageDraft | undefined;
  let importedStyles: Record<string, GalleryCellStyle> | undefined;
  const importedInput = { ...input };
  let transfer: ReturnType<typeof useGalleryExcelTransfer> | undefined;
  function Harness() {
    transfer = useGalleryExcelTransfer({ competitors, ownImages, input, cellStyles, competitorColumns: [{ key: "competitor-0", type: "competitor", label: "Competitor 1", images: competitor.images, index: 0 }], mineColumn: { key: "mine", type: "mine", label: "Mine", images: [], index: 0 }, excelRows: ["Image 1", "ASIN", "A+"], infoRows: [{ label: "ASIN", competitorValue: (row) => row.asin, mineValue: input.asin, updateMine() {}, updateCompetitor() {} }], imageRowLabels: ["Image 1"], aplusRow: { label: "A+", competitorValue: (row) => row.aplus, mineValue: input.aplusRequirements, updateMine() {}, updateCompetitor() {} }, maxRows: 1, updateBulletLine: (text) => text, setCompetitors: (action) => { importedCompetitors = typeof action === "function" ? action(competitors) : action; }, setOwnImages: (action) => { importedOwn = typeof action === "function" ? action(ownImages) : action; }, setCellStyles: (action) => { importedStyles = typeof action === "function" ? action(cellStyles) : action; }, update: (key, value) => { importedInput[key] = value; } });
    return null;
  }
  try {
    renderToStaticMarkup(createElement(Harness));
    assert.ok(transfer);
    await transfer.handleExportGalleryExcel();
    assert.ok(exported, "导出必须生成真实 xlsx blob");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await exported.arrayBuffer());
    const sheet = workbook.worksheets[0];
    assert.equal(sheet.getCell(3, 2).text, "COMPETITOR-ASIN");
    assert.equal(sheet.getImages().length, 1);
    sheet.getCell(3, 2).value = "IMPORTED-ASIN";
    sheet.getCell(3, 2).font = { bold: true, color: { argb: "FFFF0000" } };
    const bytes = await workbook.xlsx.writeBuffer();
    const modelBefore = JSON.stringify(workbook.model);
    const bytesBefore = Buffer.from(bytes);
    await transfer.handleImportGalleryExcel(new File([bytes], "fixture.xlsx"));
    assert.equal(importedCompetitors?.[0].asin, "IMPORTED-ASIN");
    assert.equal(importedCompetitors?.[0].images[0].assetId, "assets/fixture-1");
    assert.equal(importedInput.asin, "MINE-ASIN");
    assert.equal(importedInput.aplusRequirements, "自身 A+");
    assert.equal(importedOwn?.imageNotes[0], "原图片备注");
    assert.ok(importedStyles && Object.keys(importedStyles).length > 0);
    assert.equal(uploaded, 1);
    assert.deepEqual({ competitors, ownImages, input, cellStyles }, originals);
    assert.equal(JSON.stringify(workbook.model), modelBefore);
    assert.deepEqual(Buffer.from(bytes), bytesBefore);
  } finally {
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
