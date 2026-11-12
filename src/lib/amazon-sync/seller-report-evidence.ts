import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { amazonAccountReadAccess } from "./read-account";
import { amazonBusinessData } from "./business-data";
import { targetEnvironment, unseal } from "./approval-policy";
import { domainReportTypes, parseDomainReport, type DomainReportResource } from "./domain-reports";
import { SyncInputError, type SyncScope } from "./policy";

export function localSellerEvidenceEnabled(scope: SyncScope) {
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  return targetEnvironment() === "local" && url.hostname === "127.0.0.1" && url.port === "55439" && url.pathname === "/amazon_sync_live_local" && scope.organizationId === "amazon-live-local" && scope.workspaceId === "default";
}
export function distinctSellerEvidence<T extends { authorizationId: string; amazonSellerId: string; contentSha256: string }>(documents: readonly T[]) {
  const seen = new Set<string>();
  return documents.filter(document => {
    const key = JSON.stringify([document.authorizationId, document.amazonSellerId, document.contentSha256]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
/** Local evidence reader; account assignment is mandatory even for administrators. */
export async function readSellerReportEvidence(scope: SyncScope, params: URLSearchParams, actor: string) {
  params = new URLSearchParams(params);
  if (!localSellerEvidenceEnabled(scope)) throw new SyncInputError("卖家级报告证据仅限已批准独立本机环境。", 403);
  const resource = params.get("resource") as DomainReportResource;
  if (!["inventory_events", "reimbursements"].includes(resource)) throw new SyncInputError("卖家级证据仅限库存事件与赔偿。");
  for (const key of ["sourceId", "documentId"] as const) if ((params.get(key)?.length ?? 0) > 200) throw new SyncInputError("报告证据筛选长度超限。");
  const page = Math.min(1000, Math.max(1, Math.floor(Number(params.get("page")) || 1))), pageSize = 50;
  const result = await prisma.$transaction(async tx => {
    const access = await amazonAccountReadAccess(scope, actor, params, tx, resource);
    params.set("sellerAccountId", access.sellerIds[0]);
    const sellerAccountId = access.sellerIds[0];
    const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, sellerAccountId, resource, ...(params.get("sourceId") ? { id: params.get("sourceId")! } : {}) }, select: { id: true, authorizationId: true, domainPolicy: true, coverage: true, authorization: { select: { amazonSellerId: true, identityVerifiedAt: true } } }, orderBy: { id: "asc" } });
    if (!source || !source.authorization.amazonSellerId || !source.authorization.identityVerifiedAt) throw new SyncInputError("缺少已核验卖家身份的报告来源。", 409);
    const collector = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, sellerAccountId, resource, authorizationId: source.authorizationId, marketplaceId: "ATVPDKIKX0DER", domainPolicy: { path: ["mode"], equals: "seller-archive-only" } }, select: { coverage: true } });
    const coverage = (collector?.coverage ?? source.coverage) as { archiveCollection?: { status?: string; lastCompletedAt?: string; from?: string; to?: string; rows?: number } } | null;
    const collection = coverage?.archiveCollection;
    const archiveCollection = collection ? { status: collection.status, lastCompletedAt: collection.lastCompletedAt, from: collection.from, to: collection.to, rows: collection.rows, siteFacts: false } : null;
    const stored = await tx.amazonSyncReportDocument.findMany({ where: { ...scope, sellerAccountId, resource, reportType: domainReportTypes[resource], amazonSellerId: source.authorization.amazonSellerId, source: { authorizationId: source.authorizationId } }, orderBy: [{ capturedAt: "desc" }, { id: "asc" }], take: 101, select: { id: true, sourceId: true, sourceRunId: true, amazonSellerId: true, reportId: true, contentSha256: true, capturedAt: true, rowCount: true, status: true } });
    if (stored.length > 100) throw new SyncInputError("报告证据超过单次100份上限，请缩小采集范围。", 409);
    const unique = distinctSellerEvidence(stored.map(d => ({ ...d, authorizationId: source.authorizationId })));
    const selected = params.get("documentId") ? unique.find(d => d.id === params.get("documentId")) : unique[0];
    if (params.get("documentId") && !selected) throw new SyncInputError("报告证据不可访问或已被内容去重。", 403);
    const documents = unique.map(d => ({ id: d.id, reportId: d.reportId, capturedAt: d.capturedAt, rowCount: d.rowCount, sourceRunId: d.sourceRunId, attribution: "SELLER_ONLY" as const }));
    if (!selected) return { resource, archiveCollection, documents, rows: [], pagination: { page, pageSize, total: 0, pageCount: 0 }, duplicateReports: stored.length - unique.length, attribution: "SELLER_ONLY" as const, siteFacts: false as const };
    const archive = await tx.amazonSyncRawPage.findFirst({ where: { ...scope, resource, bodySha256: selected.contentSha256, task: { sourceId: selected.sourceId, source: { sellerAccountId } } }, select: { taskId: true, page: true, rawCiphertext: true } });
    if (!archive) throw new SyncInputError("报告原件缺失，不能展示证据。", 409);
    const raw = unseal(archive.rawCiphertext, scope, `${archive.taskId}:${archive.page}`, `amazon-${resource}-raw.v1`) as { rawText?: unknown };
    if (typeof raw.rawText !== "string" || createHash("sha256").update(raw.rawText).digest("hex") !== selected.contentSha256) throw new SyncInputError("报告原件摘要校验失败。", 409);
    const parsed = parseDomainReport(resource, raw.rawText, { offset: (page - 1) * pageSize, limit: pageSize });
    if (parsed.rowCount !== selected.rowCount) throw new SyncInputError("报告原件行数与归档不一致。", 409);
    return { resource, archiveCollection, documents, selectedDocumentId: selected.id, rows: parsed.rows.map(row => ({ rowNumber: row.rowNumber, businessDate: row.businessDate, orderId: row.orderId, sellerSku: row.sellerSku, asin: row.asin, transactionType: row.transactionType, amountOriginal: row.amountOriginal, currencyCode: row.currencyCode, quantityOriginal: row.quantityOriginal, fields: amazonBusinessData(row.fields) })), pagination: { page, pageSize, total: parsed.rowCount, pageCount: Math.ceil(parsed.rowCount / pageSize) }, duplicateReports: stored.length - unique.length, attribution: "SELLER_ONLY" as const, siteFacts: false as const };
  }, { timeout: 15000 });
  await amazonAccountReadAccess(scope, actor, params, prisma, resource);
  return result;
}
