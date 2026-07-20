import {
  buildBWorkbook,
  buildBWorkbookFromTemplateBuffer,
  buildCWorkbook,
  buildComparisonWorkbook,
  buildDWorkbooks,
  buildSaihuWorkbook,
  buildSummaryWorkbook,
  parseAWorkbookBuffer,
  parseAWorkbook,
  parseBWorkbook,
  parseCWorkbookBuffer,
  parseCWorkbook,
  parseDWorkbookBuffer,
  parseDWorkbook,
  parseSaihuWorkbookBuffer,
  parseSaihuWorkbook,
} from "@/lib/logistics/excel";
import { parsePdfBuffer, parsePdfFile } from "@/lib/logistics/pdf";
import type {
  AWorkbookSummary,
  LogisticsTemplateOption,
  NamedWorkbookExportResult,
  PdfSummary,
  WorkbookExportResult,
} from "@/lib/logistics/types";

export type LogisticsParseAOptions = {
  skipImages?: boolean;
};

export async function parseLogisticsAWorkbook(file: File, options: LogisticsParseAOptions = {}) {
  return parseAWorkbook(file, options);
}

export async function parseLogisticsAWorkbookBuffer(buffer: ArrayBuffer, fileName: string, options: LogisticsParseAOptions = {}) {
  return parseAWorkbookBuffer({ buffer, fileName }, options);
}

export async function parseLogisticsBWorkbook() {
  return parseBWorkbook();
}

export async function parseLogisticsCWorkbook(file: File) {
  return parseCWorkbook(file);
}

export async function parseLogisticsCWorkbookBuffer(buffer: ArrayBuffer, fileName: string) {
  return parseCWorkbookBuffer({ buffer, fileName });
}

export async function parseLogisticsSaihuWorkbook(file: File) {
  return parseSaihuWorkbook(file);
}

export async function parseLogisticsSaihuWorkbookBuffer(buffer: ArrayBuffer, fileName: string) {
  return parseSaihuWorkbookBuffer({ buffer, fileName });
}

export async function parseLogisticsDWorkbook(file: File) {
  return parseDWorkbook(file);
}

export async function parseLogisticsDWorkbookBuffer(buffer: ArrayBuffer, fileName: string) {
  return parseDWorkbookBuffer({ buffer, fileName });
}

export async function parseLogisticsPdfFile(file: File) {
  return parsePdfFile(file);
}

export async function parseLogisticsPdfBuffer(buffer: ArrayBuffer, fileName: string) {
  return parsePdfBuffer(buffer, fileName);
}

export async function parseLogisticsPdfFiles(files: File[]) {
  return Promise.all(files.map((file) => parseLogisticsPdfFile(file)));
}

export async function parseLogisticsPdfBuffers(files: Array<{ buffer: ArrayBuffer; fileName: string }>) {
  return Promise.all(files.map((file) => parseLogisticsPdfBuffer(file.buffer, file.fileName)));
}

export async function buildLogisticsBWorkbook(aSummary: AWorkbookSummary): Promise<WorkbookExportResult> {
  return buildBWorkbook(aSummary);
}

export async function buildLogisticsBWorkbookFromTemplateBuffer(
  aSummary: AWorkbookSummary,
  templateBuffer: ArrayBuffer,
): Promise<WorkbookExportResult> {
  return buildBWorkbookFromTemplateBuffer(aSummary, templateBuffer);
}

export async function buildLogisticsCWorkbook(file: File, aSummary: AWorkbookSummary): Promise<WorkbookExportResult> {
  return buildCWorkbook(file, aSummary);
}

export async function buildLogisticsSaihuWorkbook(file: File, aSummary: AWorkbookSummary): Promise<WorkbookExportResult> {
  return buildSaihuWorkbook(file, aSummary);
}

export async function buildLogisticsSummaryWorkbook(
  aSummary: AWorkbookSummary,
  pdfSummary: PdfSummary | null,
): Promise<WorkbookExportResult> {
  return buildSummaryWorkbook(aSummary, pdfSummary);
}

export async function buildLogisticsComparisonWorkbook(
  aSummary: AWorkbookSummary,
  pdfSummaries: PdfSummary[],
): Promise<WorkbookExportResult> {
  return buildComparisonWorkbook(aSummary, pdfSummaries);
}

export async function buildLogisticsDWorkbooks(input: {
  aSummary: AWorkbookSummary;
  pdfSummaries: PdfSummary[];
  templateId: LogisticsTemplateOption["id"] | string;
}): Promise<NamedWorkbookExportResult[]> {
  return buildDWorkbooks(input.aSummary, input.pdfSummaries, input.templateId);
}

export async function runLogisticsFullBuild(input: {
  aSummary: AWorkbookSummary;
  cFile?: File;
  saihuFile?: File;
  pdfSummaries: PdfSummary[];
  templateId: string;
}) {
  const [bExport, cExport, saihuExport, compareExport, dExports] = await Promise.all([
    buildLogisticsBWorkbook(input.aSummary),
    input.cFile ? buildLogisticsCWorkbook(input.cFile, input.aSummary) : Promise.resolve(null),
    input.saihuFile ? buildLogisticsSaihuWorkbook(input.saihuFile, input.aSummary) : Promise.resolve(null),
    input.pdfSummaries.length ? buildLogisticsComparisonWorkbook(input.aSummary, input.pdfSummaries) : Promise.resolve(null),
    input.pdfSummaries.length
      ? buildLogisticsDWorkbooks({
          aSummary: input.aSummary,
          pdfSummaries: input.pdfSummaries,
          templateId: input.templateId,
        })
      : Promise.resolve([]),
  ]);

  return {
    bExport,
    cExport,
    saihuExport,
    compareExport,
    dExports,
  };
}
