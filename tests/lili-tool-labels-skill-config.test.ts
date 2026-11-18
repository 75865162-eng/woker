import assert from "node:assert/strict";
import test from "node:test";
import { listTools } from "@/lib/lili/catalog";
import { findSkillView, listSkillViews } from "@/lib/skill-engine/config";
import { exportReport } from "@/lib/skill-engine/exporter";
import JSZip from "jszip";

test("全部工具都有来自中文对照表的中文名/类型/中文说明", () => {
  const tools = listTools();
  assert.equal(tools.length, 107);
  for (const tool of tools) {
    assert.ok(tool.nameZh?.trim(), `${tool.name} 缺少中文名`);
    assert.ok(tool.descriptionZh?.trim(), `${tool.name} 缺少中文说明`);
    assert.ok(["只读", "写/受控", "受控"].includes(tool.kindLabel ?? ""), `${tool.name} 类型异常: ${tool.kindLabel}`);
    // 只读标记须与 shipped 注解一致，中文标签不得篡改执行能力。
    assert.equal(tool.kindLabel === "只读", tool.readOnly, `${tool.name} 中文类型与 readOnlyHint 不一致`);
  }
});

test("技能导出格式按分类派生：补货/数据类出表格，说明类出 Word", () => {
  const views = listSkillViews();
  assert.ok(views.length >= 100);
  const restock = views.find((view) => view.category === "restock" || view.category === "inventory");
  assert.ok(restock, "应存在补货类技能");
  assert.equal(restock!.exportFormat, "xlsx");
  const listing = views.find((view) => view.category === "listing");
  assert.ok(listing, "应存在 Listing 说明类技能");
  assert.equal(listing!.exportFormat, "docx");
  for (const view of views) {
    assert.ok(["xlsx", "docx"].includes(view.exportFormat));
    assert.ok(view.inputs.some((input) => input.key === "brief"), "每个技能都应允许运行人补充资料");
  }
  // 通过 slug 查找保持一致。
  assert.equal(findSkillView(restock!.slug)?.exportFormat, "xlsx");
});

test("导出层生成真实可打开的 XLSX 与 DOCX（含数据行，缺失保留 NEEDS_DATA）", async () => {
  const report = {
    title: "补货建议",
    markdown: "## 结论\n示例报告正文。",
    rows: [{ "SKU": "B0TEST", "建议补货量": null, "备注": "缺少在途数据" }],
    notes: ["示例说明"],
  };
  const xlsx = await exportReport("xlsx", report, "test.xlsx");
  assert.ok(xlsx.byteLength > 500);
  // XLSX 是 zip，确认 magic。
  assert.equal(Buffer.from(xlsx.slice(0, 2)).toString("hex"), "504b");

  const docx = await exportReport("docx", report, "test.docx");
  assert.ok(docx.byteLength > 500);
  assert.equal(Buffer.from(docx.slice(0, 2)).toString("hex"), "504b");
  const zip = await JSZip.loadAsync(Buffer.from(docx));
  const documentXml = await zip.file("word/document.xml")!.async("string");
  assert.ok(documentXml.includes("补货建议"));
  assert.ok(documentXml.includes("NEEDS_DATA"), "缺失值须标注 NEEDS_DATA，不得补零");
});
