import { SellfoxRequestError } from "@/lib/sellfox/client";
import { SellfoxSyncInputError, SellfoxSyncUnavailableError } from "@/lib/sellfox/sync-contract";

export function sellfoxStoreFailure(error: unknown) {
  if (error instanceof SellfoxStoreSyncError) return { error: error.message, retryable: error.retryable };
  if (error instanceof SellfoxSyncUnavailableError) return { error: error.message, retryable: false };
  if (error instanceof SellfoxRequestError) return { error: error.message, retryable: error.retryable };
  if (error instanceof SellfoxSyncInputError) return { error: error.message, retryable: false };
  // Unknown DB/transport errors must never copy query text or payload into run logs.
  return { error: "本地快照提交失败或同步处理异常。", retryable: true };
}

/** createTask already left a local row: only timeouts / post-send transport stay `creating`. */
export function sellfoxCreateTaskAmbiguous(error: unknown) {
  if (error instanceof SellfoxSyncUnavailableError) return false;
  if (error instanceof SellfoxSyncInputError) {
    // These messages ARE the ambiguous lock; never convert them into `failed`.
    return error.message.includes("创建结果不明") || error.message.includes("同范围存在创建结果不明");
  }
  if (error instanceof SellfoxRequestError) {
    if (error.message.includes("未发送请求")) return false;
    return error.message.includes("请求超时")
      || error.message.includes("请求或限流连接暂时失败")
      || error.message.includes("本次请求已停止");
  }
  // Unknown errors after the HTTP call may still have been accepted upstream.
  return true;
}

export class SellfoxStoreSyncError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); this.name = "SellfoxStoreSyncError"; }
}
