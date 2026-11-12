import type { Prisma } from "@prisma/client";
import { digest, unseal } from "./approval-policy";
import { implementedFieldMapping } from "./field-mappings";
import { fieldIdentity } from "./field-scan";
import { SyncInputError, type SyncScope } from "./policy";
import { domainReportTypes, type NormalizedDomainReportRow } from "./domain-reports";
import { reportVerifiedRowWhere, reportAttributionVersion } from "./report-row-attribution";

type ExpectedRow = Pick<NormalizedDomainReportRow, "rowNumber" | "rowHash" | "amountOriginal" | "currencyCode">;
export function comparePersistedReportCell(expected: Array<{ rowNumber: number; rowHash: string; fields: unknown }>, stored: Array<{ rowNumber: number; rowHash: string; fields: unknown }>, key: string) {
  const project = (row: { rowNumber: number; rowHash: string; fields: unknown }) => {
    const fields = row.fields && typeof row.fields === "object" && !Array.isArray(row.fields) ? row.fields as Record<string, unknown> : {};
    return { rowNumber: row.rowNumber, rowHash: row.rowHash, cell: Object.hasOwn(fields, key) ? fields[key] : null };
  };
  return comparePersistedField(expected.map(project), stored.map(project), "cell");
}
export function comparePersistedField<T extends { rowNumber: number; rowHash: string }, K extends keyof T>(expected: T[], stored: Array<{ rowNumber: number; rowHash: string } & Partial<Record<K, unknown>>>, column: K) {
  if (new Set(expected.map(row => row.rowNumber)).size !== expected.length || new Set(stored.map(row => row.rowNumber)).size !== stored.length) throw new SyncInputError("字段持久化核对行号重复。", 409);
  const byNumber = new Map(stored.map(row => [row.rowNumber, row]));
  let matchedRows = 0, nullRows = 0, missingRows = 0, mismatchRows = 0;
  for (const row of expected) {
    const actual = byNumber.get(row.rowNumber);
    if (!actual) { missingRows++; continue; }
    if (actual.rowHash !== row.rowHash || actual[column] !== row[column]) { mismatchRows++; continue; }
    matchedRows++;
    if (actual[column] === null) nullRows++;
  }
  return { checkedRows: expected.length, matchedRows, nullRows, nonNullRows: matchedRows - nullRows, missingRows, mismatchRows,
    status: !expected.length ? "NO_ROWS" : missingRows || mismatchRows ? "FAILED" : "PASSED" };
}

/** Called under the existing settlement transaction/fence after the actual
 * insert. Evidence covers only its exact attributed batch, never all history.
 * No values, identifiers from cells, or raw paths enter audit metadata. */
export async function recordSettlementFieldPersistence(tx: Prisma.TransactionClient, scope: SyncScope, actor: string, input: {
  sourceId: string; reportDocumentId: string; rawTaskId: string; rawPage: number; rows: ExpectedRow[];
}) {
  if (!input.rows.length) return { passed: true, checkedFields: 0 };
  if (input.rows.length > 500) throw new SyncInputError("字段核对批次超过上限。", 409);
  const document = await tx.amazonSettlementReport.findFirst({ where: { ...scope, id: input.reportDocumentId, rawTaskId: input.rawTaskId, rawPage: input.rawPage } });
  const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: input.sourceId, resource: "settlements" } });
  if (!document || !source) throw new SyncInputError("字段核对原件、卖家或报告范围不一致。", 409);
  const raw = await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: input.rawTaskId, page: input.rawPage, resource: "settlements", task: { source: { sellerAccountId: source.sellerAccountId, authorizationId: source.authorizationId } } } });
  if (!document || !source || !raw || raw.bodySha256 !== document.contentSha256 || source.authorizationId !== document.authorizationId) throw new SyncInputError("字段核对原件、卖家或报告范围不一致。", 409);
  const metadata = raw.requestMetadata && typeof raw.requestMetadata === "object" && !Array.isArray(raw.requestMetadata) ? raw.requestMetadata : {};
  // Never infer upstream version for legacy archives.
  if (metadata.apiVersion !== "2021-06-30" || metadata.reportType !== "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2") return { passed: true, checkedFields: 0 };
  const stored = await tx.amazonSettlementRow.findMany({ where: { ...scope, sourceId: source.id, reportDocumentId: document.id, attributionStatus: "ATTRIBUTED", marketplaceId: source.marketplaceId,
    rowNumber: { in: input.rows.map(row => row.rowNumber) } }, select: { rowNumber: true, rowHash: true, amountOriginal: true, currencyCode: true } });
  const batchDigest = digest(input.rows.map(row => [row.rowNumber, row.rowHash]));
  // Only the exact primary columns have been reviewed here. Alias attribution
  // and conditional report-header currency provenance need their own evidence.
  let passed = true, checkedFields = 0;
  for (const [path, column] of [["/columns/amount", "amountOriginal"], ["/columns/currency", "currencyCode"]] as const) {
    const fieldRegistryId = digest([scope, fieldIdentity("SP_API", metadata.reportType, metadata.apiVersion, path)]);
    const mapping = await tx.amazonFieldMappingVersion.findFirst({ where: { ...scope, fieldRegistryId }, orderBy: { mappingVersion: "desc" } });
    const rule = implementedFieldMapping("settlements", metadata.reportType, metadata.apiVersion, path);
    if (!mapping || !rule || mapping.targetTable !== rule.targetTable || mapping.targetColumn !== column || digest(mapping.transformRule) !== digest({ ...rule, layer: "L1", officialDefinitionVerified: false })) continue;
    const observed = await tx.amazonFieldObservation.findFirst({ where: { ...scope, fieldRegistryId, rawTaskId: raw.taskId, rawPage: raw.page, scanComplete: true } });
    if (!observed) continue;
    const result = comparePersistedField(input.rows, stored, column);
    checkedFields++;
    if (result.status === "FAILED") passed = false;
    const evidence = { version: 1, ...scope, sourceId: source.id, reportDocumentId: document.id, rawTaskId: raw.taskId, rawPage: raw.page, rawSha256: raw.bodySha256,
      fieldRegistryId, mappingId: mapping.id, mappingVersion: mapping.mappingVersion, parserVersion: rule.parserVersion,
      targetTable: mapping.targetTable, targetColumn: column, batchDigest, ...result,
      scope: "EXACT_ATTRIBUTED_BATCH_ONLY", verificationBasis: "DATABASE_READBACK_VS_PARSER_OUTPUT", queryAcceptanceVerified: false, historicalUniverseComplete: false };
    const id = digest(["amazon-field-persistence.v1", scope, source.id, document.id, fieldRegistryId, mapping.id, batchDigest, result]);
    if (!await tx.auditLog.findUnique({ where: { id }, select: { id: true } })) await tx.auditLog.create({ data: { id, organizationId: scope.organizationId, userId: actor,
      action: "amazon.sync.fields.persistence-checked", entityType: "AmazonFieldRegistry", entityId: fieldRegistryId, metadata: evidence } });
  }
  return { passed, checkedFields };
}


/** Reports remain scoped evidence: site-qualified resources exclude quarantined
 * rows, while planning inventory records do not acquire site qualification. */
export async function recordDomainReportFieldPersistence(tx: Prisma.TransactionClient, scope: SyncScope, actor: string, input: {
  sourceId: string; resource: "inventory_events" | "reimbursements" | "inventory_age" | "removal_order_report" | "removal_shipment_report" | "fba_shipments" | "fba_customer_sales" | "mfn_returns" | "long_term_storage_fees"; reportDocumentId: string;
  rawTaskId: string; rawPage: number; rows: NormalizedDomainReportRow[];
}) {
  if (input.rows.length > 500) throw new SyncInputError("字段核对批次超过上限。", 409);
  const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: input.sourceId, resource: input.resource } });
  const document = await tx.amazonSyncReportDocument.findFirst({ where: { ...scope, id: input.reportDocumentId, sourceId: input.sourceId, resource: input.resource } });
  if (!source || !document) throw new SyncInputError("字段核对来源或报告范围不一致。", 409);
  const raw = await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: input.rawTaskId, page: input.rawPage, resource: input.resource, task: { sourceId: source.id } } });
  if (!raw || raw.bodySha256 !== document.contentSha256) throw new SyncInputError("字段核对原件摘要或范围不一致。", 409);
  const metadata = raw.requestMetadata && typeof raw.requestMetadata === "object" && !Array.isArray(raw.requestMetadata) ? raw.requestMetadata : {};
  if (metadata.apiVersion !== "2021-06-30" || metadata.reportType !== domainReportTypes[input.resource] || metadata.reportId !== document.reportId) return { passed: true, checkedFields: 0 };
  const guarded = input.resource === "inventory_events" || input.resource === "reimbursements";
  const expected = input.rows.filter(row => !guarded || row.fields.__siteEvidenceVersion === reportAttributionVersion && row.fields.__siteEvidenceStatus === "VERIFIED" && row.fields.__verifiedMarketplaceId === source.marketplaceId);
  if (!expected.length) return { passed: true, checkedFields: 0 };
  const stored = await tx.amazonSyncReportRow.findMany({ where: { ...scope, sourceId: source.id, reportDocumentId: document.id,
    ...reportVerifiedRowWhere(input.resource, source.marketplaceId), rowNumber: { in: expected.map(row => row.rowNumber) } },
    select: { rowNumber: true, rowHash: true, amountOriginal: true, currencyCode: true, orderId: true, sellerSku: true, asin: true, quantityOriginal: true, fields: true } });
  const observations = await tx.amazonFieldObservation.findMany({ where: { ...scope, rawTaskId: raw.taskId, rawPage: raw.page, scanComplete: true },
    distinct: ["fieldRegistryId"], include: { field: { include: { mappings: { orderBy: { mappingVersion: "desc" }, take: 1 } } } } });
  const columns = new Set(["amountOriginal", "currencyCode", "orderId", "sellerSku", "asin", "quantityOriginal"]);
  // If several original columns map to one target, evidence cannot identify
  // which alias supplied each row; defer those columns instead of guessing.
  const candidates = observations.flatMap(observation => {
    const mapping = observation.field.mappings[0];
    if (!mapping || mapping.targetTable !== "AmazonSyncReportRow" || !(columns.has(mapping.targetColumn) || mapping.targetColumn.startsWith("fields."))) return [];
    return [{ fieldRegistryId: observation.fieldRegistryId, mapping, pathCiphertext: observation.field.sourcePathCiphertext }];
  });
  const batchDigest = digest(expected.map(row => [row.rowNumber, row.rowHash]));
  let passed = true, checkedFields = 0;
  const events: Prisma.AuditLogCreateManyInput[] = [];
  for (const candidate of candidates) {
    const { mapping, fieldRegistryId } = candidate;
    if (candidates.filter(item => item.mapping.targetColumn === mapping.targetColumn).length !== 1) continue;
    // Verify the current executable rule against its immutable catalogue version.
    const path = unseal(candidate.pathCiphertext, scope, fieldRegistryId, "amazon-field-path.v1").sourcePath;
    if (typeof path !== "string") continue;
    const rule = implementedFieldMapping(input.resource, metadata.reportType, metadata.apiVersion, path);
    if (!rule || rule.targetColumn !== mapping.targetColumn || digest(mapping.transformRule) !== digest({ ...rule, layer: "L1", officialDefinitionVerified: false })) continue;
    const column = mapping.targetColumn;
    const result = column.startsWith("fields.") ? comparePersistedReportCell(expected, stored, column.slice(7))
      : comparePersistedField(expected, stored, column as "amountOriginal" | "currencyCode" | "orderId" | "sellerSku" | "asin" | "quantityOriginal");
    checkedFields++;
    if (result.status === "FAILED") passed = false;
    const evidence = { version: 1, ...scope, sourceId: source.id, resource: input.resource, reportDocumentId: document.id,
      rawTaskId: raw.taskId, rawPage: raw.page, rawSha256: raw.bodySha256, fieldRegistryId, mappingId: mapping.id, mappingVersion: mapping.mappingVersion,
      parserVersion: rule.parserVersion, targetTable: mapping.targetTable, targetColumn: column, batchDigest, ...result,
      scope: guarded ? "EXACT_VERIFIED_SITE_BATCH_ONLY" : "EXACT_STORED_BATCH_ONLY",
      siteQualification: guarded ? "VERIFIED_ROW_MARKERS" : "NOT_VERIFIED", verificationBasis: "DATABASE_READBACK_VS_PARSER_OUTPUT",
      queryAcceptanceVerified: false, historicalUniverseComplete: false };
    const id = digest(["amazon-domain-field-persistence.v1", scope, source.id, document.id, fieldRegistryId, mapping.id, batchDigest, result]);
    events.push({ id, organizationId: scope.organizationId, userId: actor,
      action: "amazon.sync.fields.persistence-checked", entityType: "AmazonFieldRegistry", entityId: fieldRegistryId, metadata: evidence });
  }
  if (events.length) await tx.auditLog.createMany({ data: events, skipDuplicates: true });
  return { passed, checkedFields };
}
