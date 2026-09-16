"use client";

import { createBrowserId } from "@/lib/browser/random-id";
import { saveListingAiImageAsset } from "@/lib/listing-ai/image-assets";

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

type PdfDocumentInitParameters = {
  data: Uint8Array;
  disableWorker?: boolean;
  useWorkerFetch?: boolean;
  isEvalSupported?: boolean;
};

type PdfLoadingTask = {
  promise: Promise<PdfDocumentProxy>;
};

export type ChatAttachmentKind = "image" | "document";

export interface ChatAttachment {
  id: string;
  kind: ChatAttachmentKind;
  name: string;
  mimeType: string;
  assetId?: string;
  url?: string;
  summary?: string;
}

function limitText(value: string, maxLength = 5000) {
  const normalized = value.replace(/\u0000/g, "").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}…`;
}

function looksLikeImage(file: File) {
  return file.type.startsWith("image/") || /\.(avif|gif|jpe?g|png|webp)$/i.test(file.name);
}

function looksLikeDocument(file: File) {
  return /\.(pdf|csv|xls|xlsx)$/i.test(file.name) || /^(application\/pdf|text\/csv|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)/i.test(file.type);
}

async function extractPdfSummary(file: File) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = (getDocument as unknown as (
    options: PdfDocumentInitParameters,
  ) => PdfLoadingTask)({
    data: new Uint8Array(await file.arrayBuffer()),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 8); pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent({ includeMarkedContent: false });
    const text = content.items.map((item) => item.str?.trim() ?? "").filter(Boolean).join(" ");
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized) {
      pages.push(`第 ${pageNumber} 页：${normalized}`);
    }
  }

  await pdf.destroy?.();

  return limitText(
    [`文件：${file.name}`, `页数：${pdf.numPages}`, ...pages].join("\n"),
    8000,
  );
}

async function extractSpreadsheetSummary(file: File) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true,
    cellText: true,
    cellFormula: true,
  });
  const sheets = workbook.SheetNames.slice(0, 3).map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: false,
      raw: false,
      defval: "",
    }) as Array<Array<string | number | boolean | null>>;
    const preview = rows
      .slice(0, 20)
      .map((row) => row.map((cell) => String(cell ?? "").trim()).join("\t").trim())
      .filter(Boolean)
      .join("\n");

    return `Sheet: ${sheetName}\n${preview || "空"}`;
  });

  return limitText(
    [`文件：${file.name}`, `工作表：${workbook.SheetNames.join(", ") || "无"}`, ...sheets].join(
      "\n\n",
    ),
    8000,
  );
}

async function extractCsvSummary(file: File) {
  const text = await file.text();
  return limitText(`文件：${file.name}\n\n${text}`, 8000);
}

export async function createChatAttachment(
  file: File,
  options?: {
    onUploadProgress?: (progress: number) => void;
  },
): Promise<ChatAttachment> {
  if (looksLikeImage(file)) {
    const asset = await saveListingAiImageAsset(file, options);

    return {
      id: createBrowserId(),
      kind: "image",
      name: file.name,
      mimeType: file.type || "image/*",
      assetId: asset.id,
      url: asset.url,
    };
  }

  if (!looksLikeDocument(file)) {
    throw new Error("仅支持图片、PDF、Excel 和 CSV 文件。");
  }

  const summary = file.name.toLowerCase().endsWith(".pdf")
    ? await extractPdfSummary(file)
    : file.name.toLowerCase().endsWith(".csv")
      ? await extractCsvSummary(file)
      : await extractSpreadsheetSummary(file);

  return {
    id: createBrowserId(),
    kind: "document",
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    summary,
  };
}
