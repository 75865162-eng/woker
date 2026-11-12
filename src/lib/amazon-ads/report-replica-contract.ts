import type { Prisma } from "@prisma/client";
import { digest } from "@/lib/amazon-sync/approval-policy";
import { amazonBusinessData } from "@/lib/amazon-sync/business-data";
import { SyncInputError } from "@/lib/amazon-sync/policy";
export const reportReplicaFactLimit = 500, reportReplicaVersionLimit = 50;
export const reportReplicaFactSelect = {
  reportType: true, adProduct: true, reportDate: true, factKey: true, campaignId: true, adGroupId: true,
  targetingId: true, advertisedAsin: true, searchTerm: true, placement: true, impressions: true,
  clicks: true, spend: true, orders: true, sales: true, units: true, currencyCode: true,
  attributionWindow: true, apiVersion: true, rawDimensions: true, syncedAt: true,
} as const;
export type ReportReplicaFact = {
  reportType: string; adProduct: string; reportDate: string; factKey: string;
  campaignId: string | null; adGroupId: string | null; targetingId: string | null;
  advertisedAsin: string | null; searchTerm: string | null; placement: string | null;
  impressions: string | null; clicks: string | null; orders: string | null; units: string | null;
  spend: string | null; sales: string | null; currencyCode: string | null; attributionWindow: string | null;
  apiVersion: string; rawDimensions: Prisma.JsonValue; syncedAt: string;
};
export type ReportReplicaVersion = {
  id: string; requestedFrom: string | null; requestedTo: string | null; rowCount: number; publishedAt: string;
  sourceTask: { id: string; stage: string; finishedAt: string }; facts: ReportReplicaFact[];
};
export type AdsReportReplica = {
  version: 1; domain: "ads-reports"; profileRecordId: string; amazonProfileId: string; sellerAccountId: string;
  marketplaceId: string | null; region: string; currencyCode: string | null; timezone: string | null;
  versions: ReportReplicaVersion[]; digest: string;
};
const invalid = (): never => { throw new SyncInputError("广告报表副本格式、范围或完整性无效，未发布本地版本。", 409); };
const shape = (v: unknown, keys: string[]): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key));
const text = (v: unknown, max = 200) => typeof v === "string" && v.length > 0 && v.length <= max;
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const day = (v: unknown) => date(v) && String(v).endsWith("T00:00:00.000Z");
export function parseAdsReportReplica(input: unknown): AdsReportReplica {
  if (!shape(input, ["version", "domain", "profileRecordId", "amazonProfileId", "sellerAccountId", "marketplaceId", "region", "currencyCode", "timezone", "versions", "digest"])) return invalid();
  const value = input as unknown as AdsReportReplica;
  if (value.version !== 1 || value.domain !== "ads-reports" || !Array.isArray(value.versions) || !value.versions.length || value.versions.length > reportReplicaVersionLimit || Buffer.byteLength(JSON.stringify(value)) > 450 * 1024) return invalid();
  for (const key of ["profileRecordId", "amazonProfileId", "sellerAccountId", "region"] as const) if (!text(value[key])) return invalid();
  for (const key of ["marketplaceId", "currencyCode", "timezone"] as const) if (value[key] !== null && !text(value[key])) return invalid();
  let total = 0; const versions = new Set<string>(), tasks = new Set<string>();
  for (const version of value.versions) {
    if (!shape(version, ["id", "requestedFrom", "requestedTo", "rowCount", "publishedAt", "sourceTask", "facts"]) || !text(version.id) || versions.has(version.id) || !date(version.publishedAt)) return invalid();
    if (version.requestedFrom !== null && !day(version.requestedFrom) || version.requestedTo !== null && !day(version.requestedTo) || version.requestedFrom && version.requestedTo && version.requestedFrom > version.requestedTo) return invalid();
    if (!Array.isArray(version.facts) || !Number.isSafeInteger(version.rowCount) || version.rowCount !== version.facts.length || (total += version.rowCount) > reportReplicaFactLimit) return invalid();
    const task = version.sourceTask;
    if (!shape(task, ["id", "stage", "finishedAt"]) || !text(task.id) || !text(task.stage) || !date(task.finishedAt) || tasks.has(task.id)) return invalid();
    versions.add(version.id); tasks.add(task.id);
    const seen = new Set<string>();
    for (const row of version.facts) {
      if (!shape(row, Object.keys(reportReplicaFactSelect)) || !day(row.reportDate) || !date(row.syncedAt)) return invalid();
      for (const key of ["reportType", "adProduct", "apiVersion", "factKey"] as const) if (!text(row[key], 10000)) return invalid();
      for (const key of ["campaignId", "adGroupId", "targetingId", "advertisedAsin", "searchTerm", "placement", "currencyCode", "attributionWindow"] as const) if (row[key] !== null && (typeof row[key] !== "string" || row[key].length > 10000)) return invalid();
      for (const key of ["impressions", "clicks", "orders", "units"] as const) if (row[key] !== null && (typeof row[key] !== "string" || !/^-?\d{1,19}$/.test(row[key]) || BigInt(row[key]) > BigInt("9223372036854775807") || BigInt(row[key]) < BigInt("-9223372036854775808"))) return invalid();
      for (const key of ["spend", "sales"] as const) if (row[key] !== null && (typeof row[key] !== "string" || !/^-?\d{1,14}(?:\.\d{1,6})?$/.test(row[key]))) return invalid();
      try { if (row.rawDimensions === undefined || digest(amazonBusinessData(row.rawDimensions)) !== digest(row.rawDimensions)) return invalid(); } catch { return invalid(); }
      if (version.requestedFrom && row.reportDate < version.requestedFrom || version.requestedTo && row.reportDate > version.requestedTo) return invalid();
      const identity = JSON.stringify([row.reportType, row.adProduct, row.reportDate, row.factKey]);
      if (seen.has(identity)) return invalid(); seen.add(identity);
    }
  }
  const { digest: checksum, ...body } = value;
  if (typeof checksum !== "string" || checksum !== digest(body)) return invalid();
  return value;
}
