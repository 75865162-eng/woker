import { SyncInputError } from "@/lib/amazon-sync/policy";
/** Historical entry point is deliberately inert. Only the approved v2 processor executes. */
export async function processAmazonSyncRun(...args: unknown[]): Promise<never> { void args; throw new SyncInputError("旧执行器已退役。", 410); }
export async function enqueuePendingAmazonSyncRuns(...args: unknown[]): Promise<string[]> { void args; return []; }
export async function recoverStaleAmazonSyncRuns(...args: unknown[]): Promise<number> { void args; return 0; }
