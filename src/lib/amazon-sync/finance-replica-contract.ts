import { Prisma } from "@prisma/client";
import { digest } from "./approval-policy";
import { amazonBusinessData } from "./business-data";
import { SyncInputError } from "./policy";
export const financeReplicaLimit = 500;
export const financeReplicaSelect = {
  transactionId: true, marketplaceId: true, marketplaceTimeZone: true, attributionStatus: true, quarantineReason: true,
  postedAt: true, transactionType: true, rawStatus: true, orderId: true, classification: true,
  originalAmount: true, amount: true, currency: true, convertedAmount: true, convertedCurrency: true,
  conversionStatus: true, fxEvidence: true, observationSequence: true, rowHash: true, capturedAt: true,
  task: { select: { id: true, status: true, stage: true, resource: true, sourceId: true } },
} as const;
export type FinanceReplicaRow = {
  transactionId: string; marketplaceId: string | null; marketplaceTimeZone: string | null; attributionStatus: string; quarantineReason: string | null;
  postedAt: string; transactionType: string | null; rawStatus: string | null; orderId: string | null; classification: string;
  originalAmount: string | null; amount: string | null; currency: string | null; convertedAmount: string | null; convertedCurrency: string | null;
  conversionStatus: string; fxEvidence: Prisma.JsonValue; observationSequence: number; rowHash: string; capturedAt: string;
  task: { id: string; status: string; stage: string; resource: "finance"; sourceId: string };
};
export type FinanceReplica = { version: 1; domain: "finance"; sourceId: string; sellerAccountId: string; amazonSellerId: string; marketplaceId: string; rows: FinanceReplicaRow[]; digest: string };
const shape = (v: unknown, keys: string[]) => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key));
const text = (v: unknown, max = 10000) => typeof v === "string" && v.length > 0 && v.length <= max;
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const decimal = (v: unknown) => v === null || typeof v === "string" && /^-?\d{1,35}(?:\.\d{1,30})?$/.test(v);
const invalid = (): never => { throw new SyncInputError("财务副本格式、来源或完整性无效，未修改本地数据。", 409); };
export function parseFinanceReplica(input: unknown): FinanceReplica {
  if (!shape(input, ["version", "domain", "sourceId", "sellerAccountId", "amazonSellerId", "marketplaceId", "rows", "digest"])) return invalid();
  const value = input as FinanceReplica;
  if (value.version !== 1 || value.domain !== "finance" || !Array.isArray(value.rows) || value.rows.length > financeReplicaLimit || Buffer.byteLength(JSON.stringify(value)) > 450 * 1024) return invalid();
  for (const key of ["sourceId", "sellerAccountId", "amazonSellerId", "marketplaceId"] as const) if (!text(value[key], 200)) return invalid();
  const seen = new Set<string>(), tasks = new Map<string, string>();
  for (const row of value.rows) {
    if (!shape(row, Object.keys(financeReplicaSelect)) || !text(row.transactionId, 500) || seen.has(row.transactionId) || !date(row.postedAt) || !date(row.capturedAt) || !Number.isSafeInteger(row.observationSequence) || row.observationSequence < 1 || row.observationSequence > 2147483647 || !/^[a-f0-9]{64}$/.test(row.rowHash)) return invalid();
    for (const key of ["marketplaceId", "marketplaceTimeZone", "quarantineReason", "transactionType", "rawStatus", "orderId", "originalAmount", "currency", "convertedCurrency"] as const) if (row[key] !== null && (typeof row[key] !== "string" || row[key].length > 10000)) return invalid();
    if (!text(row.classification, 100) || !text(row.conversionStatus, 100) || !decimal(row.amount) || !decimal(row.convertedAmount)) return invalid();
    if (row.marketplaceTimeZone !== null) { try { new Intl.DateTimeFormat("en", { timeZone: row.marketplaceTimeZone }); } catch { return invalid(); } }
    if (row.attributionStatus === "ATTRIBUTED") {
      if (!text(row.marketplaceId, 200) || !text(row.marketplaceTimeZone, 100) || row.quarantineReason !== null || !text(row.currency, 3) || !/^[A-Z]{3}$/.test(row.currency!) || row.amount === null || !text(row.originalAmount, 200)) return invalid();
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d{1,3})?$/.test(row.originalAmount!)) return invalid();
      try { if (!new Prisma.Decimal(row.originalAmount!).equals(row.amount)) return invalid(); } catch { return invalid(); }
    } else if (row.attributionStatus === "QUARANTINED") {
      if (row.marketplaceId !== null || row.marketplaceTimeZone !== null || !text(row.quarantineReason, 200) || row.classification !== "UNATTRIBUTED" || row.conversionStatus !== "QUARANTINED" || [row.transactionType, row.rawStatus, row.orderId, row.originalAmount, row.amount, row.currency, row.convertedAmount, row.convertedCurrency, row.fxEvidence].some(v => v !== null)) return invalid();
    } else return invalid();
    if (row.conversionStatus === "CONVERTED") {
      if (row.convertedAmount === null || typeof row.convertedCurrency !== "string" || !/^[A-Z]{3}$/.test(row.convertedCurrency) || row.fxEvidence === null) return invalid();
    } else if (!["UNCONVERTED", "QUARANTINED"].includes(row.conversionStatus) || row.convertedAmount !== null || row.fxEvidence !== null) return invalid();
    try { if (digest(amazonBusinessData(row.fxEvidence)) !== digest(row.fxEvidence)) return invalid(); } catch { return invalid(); }
    const task = row.task;
    if (!shape(task, ["id", "status", "stage", "resource", "sourceId"]) || !text(task.id, 200) || !text(task.status, 200) || !text(task.stage, 200) || task.resource !== "finance" || task.sourceId !== value.sourceId) return invalid();
    if (tasks.has(task.id) && tasks.get(task.id) !== digest(task)) return invalid();
    tasks.set(task.id, digest(task)); seen.add(row.transactionId);
  }
  const { digest: checksum, ...body } = value;
  if (typeof checksum !== "string" || digest(body) !== checksum) return invalid();
  return value;
}
