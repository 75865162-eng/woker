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

export class SellfoxStoreSyncError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); this.name = "SellfoxStoreSyncError"; }
}
