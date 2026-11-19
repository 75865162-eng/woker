"use client";

import { parseWorkbookCore, type ParsedWorkbook, type WorkbookParseOptions } from "./workbook-parse-core";

/**
 * 把所有 Excel 解析统一投递到 Web Worker，避免 50MB 级文件在 UI 主线程
 * 同步解析造成卡顿。Node/SSR 测试环境没有 Worker 时，回退到同一份解析核心
 * （workbook-parse-core.ts），确保 worker 与 fallback 是同一套解析逻辑。
 */
export async function parseWorkbookInWorker<T>(
  source: File | ArrayBuffer,
  options: WorkbookParseOptions,
): Promise<ParsedWorkbook<T>> {
  // 传入 ArrayBuffer 时由调用方决定是否保留 buffer（例如还需提取内嵌图片），
  // 此时不 transfer；传入 File 时读取后可以安全 transfer。
  const fromBuffer = source instanceof ArrayBuffer;
  const buffer = fromBuffer ? source : await (source as File).arrayBuffer();

  if (typeof Worker === "undefined") {
    const result = parseWorkbookCore(buffer, options);
    return { rows: result.rows as T, sheetNames: result.sheetNames };
  }

  return await new Promise<ParsedWorkbook<T>>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../../workers/excel-parser.worker.ts", import.meta.url), { type: "module" });
    } catch {
      // Worker 构造失败时回退到主线程解析核心。
      try {
        const result = parseWorkbookCore(buffer, options);
        resolve({ rows: result.rows as T, sheetNames: result.sheetNames });
      } catch (error) {
        reject(error);
      }
      return;
    }

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      fn();
    };

    worker.onmessage = (event: MessageEvent<{ type: string; rows?: unknown; sheetNames?: string[]; message?: string }>) => {
      const message = event.data;
      if (message.type === "generic") {
        finish(() => resolve({ rows: message.rows as T, sheetNames: message.sheetNames ?? [] }));
        return;
      }
      if (message.type === "error") {
        finish(() => reject(new Error(message.message || "Excel 解析失败。")));
      }
    };

    worker.onerror = () => {
      finish(() => reject(new Error("Excel 解析 Worker 启动失败，请重试或检查文件是否损坏。")));
    };

    const transfer = { mode: "generic" as const, file: buffer, ...options };
    // 从 File 读取的 buffer 所有权可转交给 worker；调用方直接传入的 buffer 需要保留。
    worker.postMessage(transfer, fromBuffer ? [] : [buffer]);
  });
}
