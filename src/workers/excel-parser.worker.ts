import { chunkParsedBulkWorkbook, parseBulkWorkbook } from "@/lib/bulk/workbook-parser";

type ParseMessage = {
  file: ArrayBuffer;
  targetSheets: string[];
  chunkSize?: number;
};

self.onmessage = (event: MessageEvent<ParseMessage>) => {
  const { file, targetSheets, chunkSize = 1000 } = event.data;

  try {
    const parsedWorkbook = parseBulkWorkbook(file, targetSheets);

    postMessage({
      type: "start",
      sheets: parsedWorkbook.matchedSheets,
      workbookSheets: parsedWorkbook.workbookSheets,
    });

    if (parsedWorkbook.matchedSheets.length === 0) {
      postMessage({
        type: "error",
        message: `未找到可解析的 Amazon Bulk Operations Sheet。当前文件包含：${parsedWorkbook.workbookSheets.join("、") || "无"}`,
      });
      return;
    }

    for (const chunk of chunkParsedBulkWorkbook(parsedWorkbook, chunkSize)) {
      postMessage({
        type: "chunk",
        sheetName: chunk.sheetName,
        start: chunk.startRowIndex,
        rows: chunk.rows,
        startRowIndex: chunk.startRowIndex,
        progress: chunk.progress,
      });
    }

    postMessage({
      type: "complete",
      rowCount: parsedWorkbook.rowCount,
      sheets: parsedWorkbook.matchedSheets,
    });
  } catch (error) {
    postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Excel 解析失败",
    });
  }
};

export {};
