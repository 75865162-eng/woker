import { createHash } from "node:crypto";
import type { AdsAuthScope } from "./authorization";

export const adsSyncStages = ["campaigns", "ad-groups", "keywords", "targets", "negatives", "reports", "product-ads"] as const;
export type AdsSyncStage = typeof adsSyncStages[number];
// Keep checkpoint indexes backward compatible; index 5 remains the unsupported reports stage.
export const adsStructureCompleteStage = 5;
export function nextAdsStructureStage(stage: number) {
  // Preserve indexes 0–5 in existing encrypted checkpoints. New Product Ads use 6.
  if (stage === 4) return 6;
  if (stage === 6) return adsStructureCompleteStage;
  if (Number.isInteger(stage) && stage >= 0 && stage < 4) return stage + 1;
  throw new AdsSyncError("ADS_REPORT_ADAPTER_NOT_IMPLEMENTED");
}
export function adsSyncScopes(env: Record<string, string | undefined> = process.env): AdsAuthScope[] {
  if (env.AMAZON_ADS_SYNC_ENABLED !== "true") return [];
  try {
    const rows: unknown = JSON.parse(env.AMAZON_ADS_SYNC_SCOPES ?? "[]");
    if (!Array.isArray(rows) || rows.length > 100) return [];
    if (!rows.every(row => Array.isArray(row) && row.length === 2 && row.every(v => typeof v === "string" && v.length > 0 && v.length <= 200))) return [];
    const scopes = rows.map(row => ({ organizationId: row[0] as string, workspaceId: row[1] as string }));
    return scopes.filter((scope, index) => scopes.findIndex(candidate => candidate.organizationId === scope.organizationId && candidate.workspaceId === scope.workspaceId) === index);
  } catch { return []; }
}
export function adsScopeEnabled(scope: AdsAuthScope, env: Record<string, string | undefined> = process.env) {
  return adsSyncScopes(env).some(s => s.organizationId === scope.organizationId && s.workspaceId === scope.workspaceId);
}
export function adsSyncKey(parts: unknown[]) { return createHash("sha256").update(JSON.stringify(parts)).digest("hex"); }
export function adsReportWindows(from: string, to: string, maxDays: number): Array<{ from: string; to: string }> {
  const parse = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toISOString().slice(0, 10) === v ? Date.parse(v) : NaN;
  const start = parse(from), end = parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || (end - start) / 86400000 > 3650 || !Number.isInteger(maxDays) || maxDays < 1 || maxDays > 366) throw new Error("Ads report window is invalid.");
  const windows: Array<{ from: string; to: string }> = [];
  for (let cursor = start; cursor <= end; cursor += maxDays * 86400000) windows.push({ from: new Date(cursor).toISOString().slice(0, 10), to: new Date(Math.min(end, cursor + (maxDays - 1) * 86400000)).toISOString().slice(0, 10) });
  return windows;
}
export interface AdsSyncCheckpoint { stage: number; cursor: string | null; pages: number }
export function parseAdsCheckpoint(value: unknown): AdsSyncCheckpoint {
  if (value === null || value === undefined) return { stage: 0, cursor: null, pages: 0 };
  const v = value as AdsSyncCheckpoint;
  if (!v || !Number.isInteger(v.stage) || v.stage < 0 || v.stage >= adsSyncStages.length || !Number.isInteger(v.pages) || v.pages < 0 || v.pages > 10000 || (v.cursor !== null && (typeof v.cursor !== "string" || !v.cursor || v.cursor.length > 16384))) throw new Error("Ads checkpoint is invalid.");
  return { stage: v.stage, cursor: v.cursor, pages: v.pages };
}
export class AdsSyncError extends Error {
  constructor(public code: string, public retryable = false, public retryAfterMs = 0) { super(code); }
}

export function adsSyncFailureStatus(input: { adapterReady: boolean; retryable: boolean; exhausted: boolean }) {
  if (!input.adapterReady) return "WAITING_FOR_ADAPTER" as const;
  if (input.retryable && !input.exhausted) return "RETRY_WAIT" as const;
  return input.exhausted ? "FAILED" as const : "BLOCKED" as const;
}
