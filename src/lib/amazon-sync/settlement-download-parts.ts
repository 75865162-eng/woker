import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { seal, unseal } from "./approval-policy";
import type { SyncScope } from "./policy";
import { localSellerEvidenceEnabled } from "./seller-report-evidence";
import { reportDownloadLimit, reportDownloadPartSize, type ReportDownloadPart } from "../amazon/report-download-range";
const resource = "settlement_download_part", purpose = "amazon-settlement-part.v1";
export function settlementRangeEnabled(scope: SyncScope) {
  if (process.env.AMAZON_SETTLEMENT_RANGE_LOCAL !== "1") return false;
  const database = new URL(process.env.DATABASE_URL ?? "invalid:");
  return localSellerEvidenceEnabled(scope) || process.env.AMAZON_SYNC_OFFLINE_FIXTURE === "1" && database.hostname === "127.0.0.1" && database.pathname === "/amazon_sync_test" && scope.organizationId.startsWith("domain-report-fixture-") && scope.workspaceId === "domain-report-test";
}
export type SettlementPartsState = { taskId: string; pages: number[]; offset: number; total: number; etag: string; compressionAlgorithm: "GZIP" | null; charset: string; documentDigest: string };
export function validateSettlementPartsState(value: SettlementPartsState, documentDigest: string) {
  if (!value || value.documentDigest !== documentDigest || !value.taskId || !Array.isArray(value.pages) || !value.pages.length || value.pages.length > reportDownloadLimit / reportDownloadPartSize || new Set(value.pages).size !== value.pages.length || value.pages.some(page => !Number.isSafeInteger(page) || page < 1) || !Number.isSafeInteger(value.offset) || !Number.isSafeInteger(value.total) || value.offset < 1 || value.offset > value.total || value.total > reportDownloadLimit || !/^"[A-Za-z0-9-]{1,128}"$/.test(value.etag) || ![null, "GZIP"].includes(value.compressionAlgorithm) || !["utf-8", "utf8", "cp1252", "windows-1252"].includes(value.charset)) throw new Error("Invalid encrypted settlement part checkpoint");
}
export async function storeSettlementPart(tx: Prisma.TransactionClient, scope: SyncScope, taskId: string, documentDigest: string, part: ReportDownloadPart, prior?: SettlementPartsState) {
  if (prior) validateSettlementPartsState(prior, documentDigest);
  if (prior && (prior.taskId !== taskId || prior.offset !== part.offset || prior.total !== part.total || prior.etag !== part.etag || prior.compressionAlgorithm !== part.compressionAlgorithm || prior.charset !== part.charset)) throw new Error("Settlement part identity changed");
  if (!prior && part.offset !== 0) throw new Error("First settlement part must start at zero");
  if (!Number.isSafeInteger(part.total) || part.total < 1 || part.total > reportDownloadLimit || part.bytes.byteLength !== Math.min(reportDownloadPartSize, part.total - part.offset)) throw new Error("Invalid settlement part bounds");
  validateSettlementPartsState({ taskId, pages: [1], offset: part.offset + part.bytes.byteLength, total: part.total, etag: part.etag, compressionAlgorithm: part.compressionAlgorithm, charset: part.charset, documentDigest }, documentDigest);
  const last = await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId }, orderBy: { page: "desc" }, select: { page: true } });
  const page = (last?.page ?? 0) + 1;
  await tx.amazonSyncRawPage.create({ data: { ...scope, taskId, page, resource, requestMetadata: { documentDigest, offset: part.offset, total: part.total, encryptedPartial: true, complete: false }, rawCiphertext: seal({ ...part, bytes: Buffer.from(part.bytes).toString("base64"), documentDigest }, scope, `${taskId}:${page}`, purpose), bodySha256: createHash("sha256").update(part.bytes).digest("hex"), capturedAt: new Date() } });
  return { taskId, pages: [...(prior?.pages ?? []), page], offset: part.offset + part.bytes.byteLength, total: part.total, etag: part.etag, compressionAlgorithm: part.compressionAlgorithm, charset: part.charset, documentDigest };
}
export async function readSettlementParts(tx: Prisma.TransactionClient, scope: SyncScope, sourceId: string, state: SettlementPartsState, documentDigest: string) {
  validateSettlementPartsState(state, documentDigest);
  const stored = await tx.amazonSyncRawPage.findMany({ where: { ...scope, taskId: state.taskId, page: { in: state.pages }, resource, task: { sourceId } }, orderBy: { page: "asc" } });
  if (stored.length !== state.pages.length) throw new Error("Settlement encrypted parts missing");
  return stored.map((row, index) => {
    if (row.page !== state.pages[index]) throw new Error("Settlement encrypted parts out of order");
    const data = unseal(row.rawCiphertext, scope, `${row.taskId}:${row.page}`, purpose) as unknown as Omit<ReportDownloadPart, "bytes"> & { bytes: string; documentDigest: string };
    if (data.documentDigest !== documentDigest || typeof data.bytes !== "string" || data.total !== state.total || data.etag !== state.etag || data.charset !== state.charset || data.compressionAlgorithm !== state.compressionAlgorithm) throw new Error("Settlement encrypted part identity mismatch");
    const bytes = Buffer.from(data.bytes, "base64");
    if (createHash("sha256").update(bytes).digest("hex") !== row.bodySha256) throw new Error("Settlement part digest mismatch");
    return { ...data, bytes };
  });
}
