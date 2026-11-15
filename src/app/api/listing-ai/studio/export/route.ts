import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import {
  studioComparisonDimensions,
  studioScoreFields,
  studioTones,
  type StudioProductInput,
  type StudioResult,
} from "@/lib/listing-ai/studio";

export const runtime = "nodejs";

type ExportRequestBody = {
  input?: Partial<StudioProductInput>;
  result?: StudioResult;
  model?: { provider?: string; model?: string };
};

const numberFormats = new Set(["title", "keywords", "conversion", "compliance"]);

/** Excel 会把 = + - @ 开头的字符串当公式执行，导出前统一转义。 */
function safe(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);

  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function POST(request: Request) {
  const permission = await requireApiPermission("listingAi", "export", request);

  if (!permission.ok) {
    return permission.response;
  }

  try {
    const body = (await request.json()) as ExportRequestBody;
    const result = body.result;
    const input = body.input ?? {};

    if (!result || !asArray(result.titles).length) {
      return NextResponse.json({ error: "没有可导出的生成结果。" }, { status: 400 });
    }

    const now = new Date();
    const generatedAt = now.toLocaleString("zh-CN", { hour12: false });
    const dateLabel = now.toISOString().slice(0, 10);
    const productName =
      asString(input.englishName).trim() ||
      asString(input.chineseName).trim() ||
      asString(input.asin).trim() ||
      "listing";
    const marketplace = asString(input.marketplace) || "US";
    const toneLabel = studioTones.find((item) => item.id === input.tone)?.label ?? asString(input.tone);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Listing Studio";
    workbook.created = now;

    const headerStyle = (sheet: ExcelJS.Worksheet) => {
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176B87" } };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
    };

    // 1. 概览
    const overview = workbook.addWorksheet("概览");
    overview.columns = [
      { key: "label", width: 20 },
      { key: "value", width: 80 },
    ];
    overview.addRow({ label: "指标", value: "内容" });
    headerStyle(overview);
    overview.addRows([
      { label: "产品", value: safe(productName) },
      { label: "站点", value: safe(marketplace) },
      { label: "语气", value: safe(toneLabel) },
      { label: "ASIN", value: safe(input.asin) },
      { label: "生成时间", value: generatedAt },
      { label: "生成模型", value: safe(`${body.model?.provider ?? ""} ${body.model?.model ?? ""}`.trim()) },
    ]);

    const scoreMap = (result.scores ?? {}) as unknown as Record<string, unknown>;
    studioScoreFields.forEach((field) => {
      const value = numberFormats.has(field.id) ? scoreMap[field.id] : 0;
      overview.addRow({
        label: `评分 · ${field.label}`,
        value: typeof value === "number" && value > 0 ? value : "未评分",
      });
    });

    const analysis = result.aiAnalysis;
    if (analysis) {
      overview.addRow({ label: "", value: "" });
      overview.addRow({ label: "定位", value: safe(analysis.position) });
      (
        [
          ["优势", analysis.strength],
          ["短板", analysis.weakness],
          ["机会", analysis.opportunity],
          ["风险", analysis.risk],
        ] as Array<[string, string[]]>
      ).forEach(([label, items]) => {
        overview.addRow({ label, value: safe(asArray<string>(items).join("\n")) });
        overview.getRow(overview.rowCount).alignment = { wrapText: true, vertical: "top" };
      });
    }

    if (asArray<string>(result.missingFacts).length) {
      overview.addRow({ label: "", value: "" });
      overview.addRow({
        label: "上架前必须补齐",
        value: safe(asArray<string>(result.missingFacts).join("\n")),
      });
      overview.getRow(overview.rowCount).alignment = { wrapText: true, vertical: "top" };
    }

    overview.eachRow((row) => {
      row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    });

    // 2. Listing 文案
    const copySheet = workbook.addWorksheet("Listing 文案");
    copySheet.columns = [
      { header: "类型", key: "type", width: 16 },
      { header: "序号", key: "index", width: 8 },
      { header: "内容", key: "text", width: 90 },
      { header: "字符数", key: "chars", width: 10 },
      { header: "说明 / 来源", key: "note", width: 40 },
    ];
    headerStyle(copySheet);

    asArray<StudioResult["titles"][number]>(result.titles).forEach((title, index) => {
      copySheet.addRow({
        type: "标题",
        index: index + 1,
        text: safe(title.text),
        chars: title.charCount || Array.from(asString(title.text)).length,
        note: safe(`${title.type} · ${title.reason}`),
      });
    });
    asArray<StudioResult["bullets"][number]>(result.bullets).forEach((bullet) => {
      copySheet.addRow({
        type: "五点描述",
        index: bullet.index,
        text: safe(bullet.text),
        chars: Array.from(asString(bullet.text)).length,
        note: safe(`卖点: ${bullet.sellingPoint} · 来源: ${bullet.sourceFact}`),
      });
    });
    copySheet.addRow({
      type: "产品描述",
      index: "",
      text: safe(result.description),
      chars: Array.from(asString(result.description)).length,
      note: "",
    });
    copySheet.addRow({
      type: "后台搜索词",
      index: "",
      text: safe(result.searchTerms),
      chars: new TextEncoder().encode(asString(result.searchTerms)).length,
      note: "字节数上限 250",
    });
    copySheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.alignment = { wrapText: true, vertical: "top" };
      row.getCell(5).alignment = { wrapText: true, vertical: "top" };
    });

    // 3. 竞品对比
    const compareSheet = workbook.addWorksheet("竞品对比");
    compareSheet.columns = [
      { header: "项目", key: "dimension", width: 18 },
      { header: "竞品", key: "competitor", width: 46 },
      { header: "我方方案", key: "ours", width: 46 },
      { header: "差异", key: "gap", width: 36 },
      { header: "建议动作", key: "action", width: 36 },
      { header: "状态", key: "status", width: 14 },
    ];
    headerStyle(compareSheet);

    const comparison = asArray<StudioResult["comparison"][number]>(result.comparison);
    studioComparisonDimensions.forEach((dimension) => {
      const row = comparison.find((item) => item.dimension === dimension);

      compareSheet.addRow({
        dimension,
        competitor: safe(row?.competitor ?? "NEEDS_DATA"),
        ours: safe(row?.ours ?? "NEEDS_DATA"),
        gap: safe(row?.gap ?? ""),
        action: safe(row?.action ?? ""),
        status: row?.status === "ok" ? "可比" : "缺数据",
      });
    });
    compareSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.alignment = { wrapText: true, vertical: "top" };
      if (row.getCell(6).value === "缺数据") {
        row.getCell(6).font = { bold: true, color: { argb: "FFB42318" } };
      }
    });

    // 4. 图片方案
    const imageSheet = workbook.addWorksheet("图片方案");
    imageSheet.columns = [
      { header: "序号", key: "index", width: 8 },
      { header: "位置", key: "slot", width: 16 },
      { header: "主题", key: "theme", width: 30 },
      { header: "卖点", key: "sellingPoint", width: 30 },
      { header: "提示词", key: "prompt", width: 90 },
      { header: "负向提示词", key: "negativePrompt", width: 50 },
    ];
    headerStyle(imageSheet);
    asArray<StudioResult["imageIdeas"][number]>(result.imageIdeas).forEach((idea, index) => {
      imageSheet.addRow({
        index: index + 1,
        slot: safe(idea.slot),
        theme: safe(idea.theme),
        sellingPoint: safe(idea.sellingPoint),
        prompt: safe(idea.prompt),
        negativePrompt: safe(idea.negativePrompt),
      });
    });
    imageSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.alignment = { wrapText: true, vertical: "top" };
    });

    // 5. 产品资料（留痕）
    const inputSheet = workbook.addWorksheet("产品资料");
    inputSheet.columns = [
      { header: "字段", key: "label", width: 22 },
      { header: "内容", key: "value", width: 100 },
    ];
    headerStyle(inputSheet);
    (
      [
        ["中文名称", input.chineseName],
        ["英文名称", input.englishName],
        ["品牌", input.brand],
        ["ASIN", input.asin],
        ["类目 / 产品类型", input.productType],
        ["站点", input.marketplace],
        ["语气", toneLabel],
        ["目标人群", input.targetAudience],
        ["使用场景", input.useScenarios],
        ["产品特点", input.features],
        ["产品参数", input.parameters],
        ["规格", input.specifications],
        ["核心关键词", input.keywords],
        ["禁止宣称", input.forbidden],
        ["竞品品牌 / ASIN", input.competitorNames],
        ["竞品标题与五点摘录", input.competitorListing],
        ["图片补充要求", input.imageNotes],
      ] as Array<[string, unknown]>
    ).forEach(([label, value]) => {
      inputSheet.addRow({ label, value: safe(asString(value)) });
      inputSheet.getRow(inputSheet.rowCount).alignment = { wrapText: true, vertical: "top" };
    });

    const output = await workbook.xlsx.writeBuffer();
    const filename = `listing-studio-${dateLabel}.xlsx`;

    return new Response(output, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(
          `Listing生成台-${productName}-${dateLabel}.xlsx`,
        )}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导出失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
