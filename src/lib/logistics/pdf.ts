import type { PdfPageSummary, PdfSummary } from "@/lib/logistics/types";
import { inferPdfMetaFromFileName } from "@/lib/logistics/utils";
import { inflate } from "pako";

type PdfTextItem = {
  str?: string;
};

type PdfDocumentProxy = {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(options?: { includeMarkedContent?: boolean }): Promise<{
      items: PdfTextItem[];
    }>;
  }>;
  destroy?(): Promise<void>;
};

type PdfJsModule = {
  getDocument(options: {
    data: Uint8Array;
    disableWorker?: boolean;
    useWorkerFetch?: boolean;
    isEvalSupported?: boolean;
  }): {
    promise: Promise<PdfDocumentProxy>;
  };
};

async function loadPdfJs(): Promise<PdfJsModule> {
  return import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as Promise<PdfJsModule>;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bytesToBinaryString(bytes: Uint8Array) {
  let result = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    result += String.fromCharCode(...chunk);
  }

  return result;
}

function decodePdfString(buffer: ArrayBuffer) {
  return bytesToBinaryString(new Uint8Array(buffer));
}

async function extractPdfPageTexts(buffer: ArrayBuffer) {
  try {
    const { getDocument } = await loadPdfJs();
    const loadingTask = getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      useWorkerFetch: false,
      isEvalSupported: false,
    });
    const pdf = await loadingTask.promise;
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: false });
      const text = content.items
        .map((item) => item.str?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      pageTexts.push(normalizePdfText(text));
    }

    await pdf.destroy?.();
    return pageTexts;
  } catch {
    return [];
  }
}

function decodeUtf16BeWithFallback(value: string) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }

  return new TextDecoder("utf-16be", { fatal: false }).decode(bytes);
}

function extractPdfStreamCandidates(buffer: ArrayBuffer) {
  const pdfBytes = new Uint8Array(buffer);
  const pdfText = decodePdfString(buffer);
  const matches = pdfText.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g);
  const candidates: string[] = [];

  for (const match of matches) {
    const streamBody = match[1];
    if (!streamBody) {
      continue;
    }

    const streamStart = match.index ? match.index + match[0].indexOf(streamBody) : -1;
    if (streamStart < 0) {
      continue;
    }

    const streamBytes = pdfBytes.slice(streamStart, streamStart + streamBody.length);

    let inflatedText = "";
    try {
      inflatedText = bytesToBinaryString(inflate(streamBytes));
    } catch {
      continue;
    }

    if (!inflatedText.includes("Tj") && !inflatedText.includes("TJ")) {
      continue;
    }

    const literalMatches = Array.from(inflatedText.matchAll(/\((.*?)\)Tj/g)).map((item) => item[1]);
    if (!literalMatches.length) {
      continue;
    }

    literalMatches.forEach((item) => {
      candidates.push(item);
      candidates.push(decodeUtf16BeWithFallback(item));
    });
  }

  return candidates.filter(Boolean);
}

function findShipmentTitleInText(text: string) {
  const normalized = normalizePdfText(text).replace(/[—–]/g, "-");
  const patterns = [
    /货件\d+-[A-Z]{3,5}\d*-FBA[A-Z0-9]+-\d+箱-[\u4e00-\u9fffA-Za-z0-9-]+/u,
    /货件\d+-[A-Z]{3,5}\d*-FBA[A-Z0-9]+-\d+箱-[^\s()]+/u,
  ];

  for (const pattern of patterns) {
    const matched = normalized.match(pattern)?.[0];
    if (matched) {
      return matched;
    }
  }

  return "";
}

function extractShipmentTitleFromStream(buffer: ArrayBuffer) {
  const candidates = extractPdfStreamCandidates(buffer);
  for (const candidate of candidates) {
    const matched = findShipmentTitleInText(candidate);
    if (matched) {
      return matched;
    }
  }

  return "";
}

function matchFirst(text: string, pattern: RegExp) {
  const matched = text.match(pattern);
  return matched?.[1] ?? "";
}

function extractPositionCode(text: string) {
  const normalized = normalizePdfText(text).toUpperCase();
  const patterns = [
    /\b(P\s*\d+\s*-\s*B\s*\d+)\b/u,
    /\b(P\s*\d+\s*B\s*\d+)\b/u,
    /\b(PAGE\s*\d+\s*-\s*BOX\s*\d+)\b/u,
  ];

  for (const pattern of patterns) {
    const matched = normalized.match(pattern)?.[1];
    if (matched) {
      return matched.replace(/\s+/g, "").replace("PAGE", "P").replace("BOX", "B");
    }
  }

  return "";
}

function normalizePdfText(text: string) {
  return text.replace(/\0/g, "").replace(/\s+/g, " ").trim();
}

function getPageCount(pdfText: string) {
  const matched = pdfText.match(/\/Count\s+(\d+)/);
  const parsed = matched ? Number(matched[1]) : null;
  return parsed && Number.isFinite(parsed) ? parsed : 1;
}

function parseShipmentTitle(titleText: string) {
  const normalizedTitle = titleText.trim().replace(/\.pdf$/i, "");
  const matched = normalizedTitle.match(
    /^(?:(货件\d+)-)?([A-Z]{3,5}\d*)-(FBA[A-Z0-9]+)-(\d+)箱(?:-(.+))?$/u,
  );

  if (!matched) {
    return null;
  }

  return {
    shipmentName: matched[1] ?? "",
    warehouseCode: matched[2] ?? "",
    fbaCode: matched[3] ?? "",
    totalBoxes: matched[4] ? Number(matched[4]) : null,
    channelName: matched[5]?.trim() ?? "",
  };
}

function buildMetaFromShipmentTitle(titleText: string) {
  const parsedTitle = parseShipmentTitle(titleText);
  if (!parsedTitle) {
    return null;
  }

  return {
    shipmentTitle: titleText,
    shipmentName: parsedTitle.shipmentName,
    warehouseCode: parsedTitle.warehouseCode,
    fbaCode: parsedTitle.fbaCode,
    totalBoxes: parsedTitle.totalBoxes,
    channelName: parsedTitle.channelName,
  };
}

function extractGlobalMeta(pdfText: string, fallbackName: string) {
  const titleText = findShipmentTitleInText(pdfText) || "";
  const parsedTitle = parseShipmentTitle(titleText);

  const shipmentName = parsedTitle?.shipmentName || "";

  const fbaBoxCodes = Array.from(pdfText.matchAll(/(FBA[A-Z0-9]+U\d{6})/g)).map((item) => item[1]);
  const firstFbaBoxCode = fbaBoxCodes[0] ?? "";
  const fbaCode =
    parsedTitle?.fbaCode ||
    (firstFbaBoxCode ? firstFbaBoxCode.replace(/U\d{6}$/u, "") : matchFirst(pdfText, /(FBA[A-Z0-9]+)/u));

  const warehouseCandidates = new Set<string>();
  for (const match of pdfText.matchAll(/\b([A-Z]{3}\d{1,2})\b/g)) {
    const value = match[1];
    if (value !== "FBA" && value !== "PDT" && value !== "SKU") {
      warehouseCandidates.add(value);
    }
  }
  const warehouseCode = parsedTitle?.warehouseCode || (Array.from(warehouseCandidates).find((value) => value !== fbaCode) ?? "");
  const titleBoxCount = parsedTitle?.totalBoxes ?? null;
  const channelNameFromTitle = parsedTitle?.channelName ?? "";

  const fallbackMeta = inferPdfMetaFromFileName(fallbackName);
  const resolvedShipmentName = shipmentName;
  const resolvedWarehouseCode = warehouseCode || fallbackMeta.warehouseCode;
  const resolvedFbaCode = fbaCode || fallbackMeta.fbaCode;
  const resolvedTotalBoxes = titleBoxCount ?? fallbackMeta.totalBoxes;
  const resolvedChannelName = channelNameFromTitle;
  const resolvedShipmentTitle = [
    resolvedShipmentName,
    resolvedWarehouseCode,
    resolvedFbaCode,
    resolvedTotalBoxes ? `${resolvedTotalBoxes}箱` : "",
    resolvedChannelName,
  ]
    .filter(Boolean)
    .join("-");

  return {
    shipmentTitle: resolvedShipmentTitle || titleText || fallbackMeta.shipmentTitle,
    shipmentName: resolvedShipmentName,
    warehouseCode: resolvedWarehouseCode,
    fbaCode: resolvedFbaCode,
    totalBoxes: resolvedTotalBoxes,
    channelName: resolvedChannelName,
  };
}

function extractPageSummaries(
  pdfText: string,
  sharedMeta: { shipmentName: string; warehouseCode: string; fbaCode: string },
  pageCount: number,
  pageTexts: string[],
  streamCandidates: string[],
) {
  const pages: PdfPageSummary[] = [];
  const globalBoxMatches = Array.from(pdfText.matchAll(/(FBA[A-Z0-9]+U\d{6})/g)).map((item) => item[1]);
  const globalSkuTypeMatches = Array.from(pdfText.matchAll(/(Single SKU|Mixed SKUs)/g)).map((item) => item[1]);
  const globalQtyMatches = Array.from(pdfText.matchAll(/Qty\s*(\d+)/g)).map((item) => Number(item[1]));
  const globalPositionMatches = streamCandidates.map((candidate) => extractPositionCode(candidate)).filter(Boolean);

  for (let index = 0; index < pageCount; index += 1) {
    const pageText = pageTexts[index] ?? "";
    const pageBoxCode = pageText.match(/(FBA[A-Z0-9]+U\d{6})/u)?.[1] ?? "";
    const pagePositionCode = extractPositionCode(pageText);
    const pageSkuType = pageText.match(/(Single SKU|Mixed SKUs)/u)?.[1] ?? "";
    const pageQty = pageText.match(/Qty\s*(\d+)/u)?.[1];

    const fbaBoxCode =
      pageBoxCode ||
      globalBoxMatches[index] ||
      (sharedMeta.fbaCode ? `${sharedMeta.fbaCode}U${String(index + 1).padStart(6, "0")}` : "");

    const skuType = pageSkuType || globalSkuTypeMatches[index] || "";
    const qty = pageQty ? Number(pageQty) : (globalQtyMatches[index] ?? null);
    const positionCode = pagePositionCode || globalPositionMatches[index] || "";

    let sku = "";
    if (skuType === "Single SKU") {
      const localText =
        pageText ||
        pdfText.slice(Math.max(0, (pdfText.indexOf(fbaBoxCode) || 0) - 400), Math.min(pdfText.length, (pdfText.indexOf(fbaBoxCode) || 0) + 800));
      const skuPattern = /Single SKU[\s\S]{0,120}?([A-Z0-9][A-Z0-9\- ]{2,})[\r\n]/;
      sku = matchFirst(localText, skuPattern).trim();
    }

    pages.push({
      pageNumber: index + 1,
      shipmentName: sharedMeta.shipmentName,
      warehouseCode: sharedMeta.warehouseCode,
      fbaCode: sharedMeta.fbaCode,
      totalBoxes: pageCount,
      fbaBoxCode,
      positionCode,
      skuType,
      sku,
      qty,
    });
  }

  return pages;
}

export async function parsePdfBuffer(buffer: ArrayBuffer, fileName: string): Promise<PdfSummary> {
  const streamCandidates = extractPdfStreamCandidates(buffer);
  const streamShipmentTitle = extractShipmentTitleFromStream(buffer);
  const pdfText = decodePdfString(buffer);
  const pageTexts = await extractPdfPageTexts(buffer);
  const parsedPageCount = getPageCount(pdfText);
  const sharedMeta =
    (streamShipmentTitle ? buildMetaFromShipmentTitle(streamShipmentTitle) : null) ??
    extractGlobalMeta(pdfText, fileName);

  const pageCount = pageTexts.length || (sharedMeta.totalBoxes && Number.isFinite(sharedMeta.totalBoxes) ? sharedMeta.totalBoxes : parsedPageCount);
  const pages = extractPageSummaries(pdfText, sharedMeta, pageCount, pageTexts, streamCandidates);
  const renamedFileName = `${sharedMeta.shipmentTitle || `${sharedMeta.shipmentName}-${sharedMeta.warehouseCode}-${sharedMeta.fbaCode}-${pageCount}箱`}.pdf`
    .replace(/\.pdf\.pdf$/i, ".pdf")
    .replace(/^-+|-+$/g, "");

  return {
    fileNameBase: fileName.replace(/\.pdf$/i, ""),
    shipmentTitle:
      sharedMeta.shipmentTitle ||
      [sharedMeta.shipmentName, sharedMeta.warehouseCode, sharedMeta.fbaCode, `${pageCount}箱`, sharedMeta.channelName].filter(Boolean).join("-"),
    shipmentName: sharedMeta.shipmentName,
    warehouseCode: sharedMeta.warehouseCode,
    fbaCode: sharedMeta.fbaCode,
    totalBoxes: pageCount,
    channelName: sharedMeta.channelName,
    renamedFileName: renamedFileName === ".pdf" ? fileName : renamedFileName,
    pages,
  };
}

export async function parsePdfFile(file: File): Promise<PdfSummary> {
  return parsePdfBuffer(await file.arrayBuffer(), file.name);
}

export function isPdfSummaryContentBased(summary: PdfSummary) {
  const expected = `${summary.shipmentTitle || `${summary.shipmentName}-${summary.warehouseCode}-${summary.fbaCode}-${summary.totalBoxes ?? 0}箱`}.pdf`;
  return new RegExp(`^${escapeRegExp(expected)}$`, "u").test(summary.renamedFileName);
}
