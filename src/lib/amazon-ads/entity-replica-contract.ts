import type { Prisma } from "@prisma/client";
import { digest } from "@/lib/amazon-sync/approval-policy";
import { amazonBusinessData } from "@/lib/amazon-sync/business-data";
import { SyncInputError } from "@/lib/amazon-sync/policy";

export const adsEntityReplicaLimit = 500;
export const adsEntityReplicaSelect = {
  entityType: true, externalId: true, parentExternalId: true, state: true, name: true,
  adProduct: true, campaignId: true, adGroupId: true, startDate: true, endDate: true,
  targetingType: true, budgetAmount: true, budgetType: true, bid: true, keywordText: true,
  matchType: true, expressionType: true, targetingExpression: true, payload: true,
  sourceUpdatedAt: true, syncedAt: true,
  sourceTask: { select: { id: true, status: true, stage: true, finishedAt: true } },
} as const;
export type AdsEntityReplicaRow = {
  entityType: string; externalId: string; parentExternalId: string | null; state: string | null;
  name: string | null; adProduct: string | null; campaignId: string | null; adGroupId: string | null;
  startDate: string | null; endDate: string | null; targetingType: string | null;
  budgetAmount: string | null; budgetType: string | null; bid: string | null; keywordText: string | null;
  matchType: string | null; expressionType: string | null; targetingExpression: Prisma.JsonValue;
  payload: Prisma.JsonValue; sourceUpdatedAt: string | null; syncedAt: string;
  sourceTask: { id: string; status: "SUCCEEDED"; stage: string; finishedAt: string };
};
export type AdsEntityReplica = {
  version: 1; domain: "ads-entities"; profileRecordId: string; amazonProfileId: string;
  sellerAccountId: string; marketplaceId: string | null; region: string;
  currencyCode: string | null; timezone: string | null; exportedAt: string;
  rows: AdsEntityReplicaRow[]; digest: string;
};
const invalid = (): never => { throw new SyncInputError("广告对象副本格式、版本或完整性无效，未发布本地数据。", 409); };
export function parseAdsEntityReplica(input: unknown): AdsEntityReplica {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid();
  const value = input as AdsEntityReplica;
  const keys = ["version", "domain", "profileRecordId", "amazonProfileId", "sellerAccountId", "marketplaceId", "region", "currencyCode", "timezone", "exportedAt", "rows", "digest"];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) || value.version !== 1 || value.domain !== "ads-entities") return invalid();
  const text = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 200;
  const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  for (const key of ["profileRecordId", "amazonProfileId", "sellerAccountId", "region"] as const) if (!text(value[key])) return invalid();
  for (const key of ["marketplaceId", "currencyCode", "timezone"] as const) if (value[key] !== null && !text(value[key])) return invalid();
  if (!date(value.exportedAt) || !Array.isArray(value.rows) || value.rows.length > adsEntityReplicaLimit || Buffer.byteLength(JSON.stringify(value)) > 450 * 1024) return invalid();
  const seen = new Set<string>(), tasks = new Map<string, string>();
  for (const row of value.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== Object.keys(adsEntityReplicaSelect).length || Object.keys(row).some(key => !Object.hasOwn(adsEntityReplicaSelect, key))) return invalid();
    if (!text(row.entityType) || !text(row.externalId) || !date(row.syncedAt)) return invalid();
    for (const key of ["parentExternalId", "state", "name", "adProduct", "campaignId", "adGroupId", "targetingType", "budgetType", "keywordText", "matchType", "expressionType"] as const) if (row[key] !== null && (typeof row[key] !== "string" || row[key].length > 10000)) return invalid();
    for (const key of ["startDate", "endDate", "sourceUpdatedAt"] as const) if (row[key] !== null && !date(row[key])) return invalid();
    // Decimal(20,6) is transferred as text; no binary floating-point conversion.
    for (const key of ["bid", "budgetAmount"] as const) if (row[key] !== null && (typeof row[key] !== "string" || !/^-?\d{1,14}(?:\.\d{1,6})?$/.test(row[key]))) return invalid();
    const task = row.sourceTask;
    if (!task || typeof task !== "object" || Object.keys(task).sort().join(",") !== "finishedAt,id,stage,status" || !text(task.id) || !text(task.stage) || task.status !== "SUCCEEDED" || !date(task.finishedAt)) return invalid();
    if (tasks.has(task.id) && tasks.get(task.id) !== digest(task)) return invalid();
    tasks.set(task.id, digest(task));
    for (const key of ["payload", "targetingExpression"] as const) {
      try { if (row[key] === undefined || digest(amazonBusinessData(row[key])) !== digest(row[key])) return invalid(); }
      catch { return invalid(); }
    }
    const identity = JSON.stringify([row.entityType, row.externalId]);
    if (seen.has(identity)) return invalid();
    seen.add(identity);
  }
  const { digest: checksum, ...body } = value;
  if (typeof checksum !== "string" || digest(body) !== checksum) return invalid();
  return value;
}
// The observation timestamp is not a new business version when contents match.
export function adsReplicaVersion(value: AdsEntityReplica) {
  const { exportedAt: unusedTime, digest: unusedDigest, ...body } = value;
  void unusedTime; void unusedDigest;
  return digest(body);
}
