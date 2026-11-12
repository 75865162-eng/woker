import { createHash } from "node:crypto";
import type { Prisma, AmazonSyncRun } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess, sourceAccessWhere } from "./data-access";
import { digest, seal, unseal } from "./approval-policy";
import { SyncInputError, type SyncScope } from "./policy";
import { implementedFieldMapping } from "./field-mappings";
import { registeredSpApiSchemas } from "./official-schema";
import { fieldIdentity, fieldScannerVersion, scanArchivedFields } from "./field-scan";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Existing raw identity is the FK and idempotency boundary. This function is
 * inside the archive transaction, before any business parsing/publication. */
export async function registerArchivedFields(tx: Prisma.TransactionClient, run: AmazonSyncRun, page: number, text: string, format: "JSON" | "REPORT") {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const raw = await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: run.id, page, resource: run.resource } });
  if (!raw) throw new SyncInputError("字段观察缺少同范围原件。", 409);
  // Existing archives use two historic hash conventions; do not rewrite them.
  if (raw.bodySha256 !== digest(text) && raw.bodySha256 !== createHash("sha256").update(text).digest("hex")) throw new SyncInputError("字段扫描原件摘要不匹配。", 409);
  const metadata = object(raw.requestMetadata);
  const sourceCode = typeof metadata.reportType === "string" ? metadata.reportType : typeof metadata.operation === "string" ? metadata.operation : run.resource;
  const apiVersion = typeof metadata.apiVersion === "string" ? metadata.apiVersion : "UNSPECIFIED";
  const sourceId = digest([scope, "SP_API", sourceCode, apiVersion]);
  const inventory = scanArchivedFields(text, format);
  await tx.amazonDataSourceRegistry.upsert({ where: { id: sourceId }, create: { ...scope, id: sourceId, provider: "SP_API", sourceCode, apiVersion,
    sourceType: typeof metadata.reportType === "string" ? "REPORT" : "API", firstSeenAt: raw.capturedAt, lastSeenAt: raw.capturedAt }, update: {} });
  await tx.amazonDataSourceRegistry.updateMany({ where: { id: sourceId, ...scope, lastSeenAt: { lt: raw.capturedAt } }, data: { lastSeenAt: raw.capturedAt } });
  await tx.amazonDataSourceRegistry.updateMany({ where: { id: sourceId, ...scope, firstSeenAt: { gt: raw.capturedAt } }, data: { firstSeenAt: raw.capturedAt } });
  if (inventory.fields.length) {
    const fields = inventory.fields.map(field => {
      const fieldId = fieldIdentity("SP_API", sourceCode, apiVersion, field.path), id = digest([scope, fieldId]);
      return { ...scope, id, sourceRegistryId: sourceId, fieldId,
        sourcePathCiphertext: seal({ sourcePath: field.path }, scope, id, "amazon-field-path.v1"), firstSeenAt: raw.capturedAt, lastSeenAt: raw.capturedAt };
    });
    await tx.amazonFieldRegistry.createMany({ data: fields, skipDuplicates: true });
    const ids = fields.map(field => field.id);
    await tx.amazonFieldRegistry.updateMany({ where: { ...scope, id: { in: ids }, lastSeenAt: { lt: raw.capturedAt } }, data: { lastSeenAt: raw.capturedAt } });
    await tx.amazonFieldRegistry.updateMany({ where: { ...scope, id: { in: ids }, firstSeenAt: { gt: raw.capturedAt } }, data: { firstSeenAt: raw.capturedAt } });
  }
  const candidates = inventory.fields.flatMap(field => {
    const mapping = implementedFieldMapping(run.resource, sourceCode, apiVersion, field.path);
    if (!mapping) return [];
    const fieldRegistryId = digest([scope, fieldIdentity("SP_API", sourceCode, apiVersion, field.path)]);
    return [{ fieldRegistryId, targetTable: mapping.targetTable, targetColumn: mapping.targetColumn,
      transformRule: { ...mapping, layer: "L1", officialDefinitionVerified: false } }];
  });
  if (candidates.length) {
    const versions = await tx.amazonFieldMappingVersion.findMany({ where: { ...scope, fieldRegistryId: { in: candidates.map(item => item.fieldRegistryId) } },
      orderBy: { mappingVersion: "desc" }, distinct: ["fieldRegistryId"] });
    const latest = new Map(versions.map(item => [item.fieldRegistryId, item]));
    const mappings = candidates.flatMap(candidate => {
      const previous = latest.get(candidate.fieldRegistryId);
      if (previous && previous.targetTable === candidate.targetTable && previous.targetColumn === candidate.targetColumn && digest(previous.transformRule) === digest(candidate.transformRule)) return [];
      const mappingVersion = (previous?.mappingVersion ?? 0) + 1;
      return [{ ...scope, ...candidate, id: digest([scope, candidate.fieldRegistryId, mappingVersion]), mappingVersion, status: "IMPLEMENTED_NOT_ACCEPTED" }];
    });
    // Never overwrite historical rules or silently skip a concurrent version
    // conflict. A uniqueness conflict rolls back the archive transaction.
    if (mappings.length) await tx.amazonFieldMappingVersion.createMany({ data: mappings });
    await tx.amazonFieldRegistry.updateMany({ where: { ...scope, id: { in: candidates.map(mapping => mapping.fieldRegistryId) }, mappingStatus: "UNMAPPED" }, data: { mappingStatus: "MAPPED" } });
  }
  // Bulk observation insert, immutable per archive/scanner version.
  if (inventory.fields.length) await tx.amazonFieldObservation.createMany({ data: inventory.fields.map(field => {
    const fieldId = digest([scope, fieldIdentity("SP_API", sourceCode, apiVersion, field.path)]);
    return { ...scope, id: digest([scope, run.id, page, fieldId, fieldScannerVersion]), fieldRegistryId: fieldId,
      rawTaskId: run.id, rawPage: page, scannerVersion: fieldScannerVersion, observedTypes: field.types,
      nullCount: field.nulls === null ? null : BigInt(field.nulls), nonNullCount: field.observations === null || field.nulls === null ? null : BigInt(field.observations - field.nulls),
      emptyStringCount: inventory.format === "tsv" ? BigInt(inventory.emptyStrings[field.path] ?? 0) : null,
      scanComplete: inventory.complete, observedAt: raw.capturedAt };
  }), skipDuplicates: true });
  // Includes empty/malformed documents: zero fields must not imply full coverage.
  const scanId = digest([scope, run.id, page, fieldScannerVersion]);
  const existing = await tx.auditLog.findFirst({ where: { id: scanId }, select: { id: true } });
  if (!existing) await tx.auditLog.create({ data: { id: scanId, organizationId: scope.organizationId, userId: run.requestedByUserId,
    action: "amazon.sync.fields.scanned", entityType: "AmazonSyncRun", entityId: run.id, metadata: {
      ...scope, sourceId: run.sourceId, rawPage: page, sourceRegistryId: sourceId, scannerVersion: fieldScannerVersion,
      observedFields: inventory.fields.length, scanComplete: inventory.complete, bodySha256: raw.bodySha256,
      structuredPersistenceVerified: false, queryAcceptanceVerified: false,
    } } });
}

/** Field paths are account-scoped metadata; samples and credentials are never returned. */
export async function readFieldRegistry(scope: SyncScope, params: URLSearchParams, actor: string, sourceFence?: string[]) {
  const access = await amazonDataAccess(scope, actor);
  const sourceId = params.get("sourceId");
  if (!sourceId || sourceId.length > 200) throw new SyncInputError("字段目录必须指定 sourceId。");
  const source = await prisma.amazonSyncDataSource.findFirst({ where: { AND: [scope, sourceAccessWhere(access), { id: sourceId }, ...(sourceFence ? [{ id: { in: sourceFence } }] : [])] }, select: { id: true, sellerAccountId: true, marketplaceId: true } });
  if (!source) throw new SyncInputError("字段来源不可访问。", 404);
  const pageText = params.get("page") ?? "1";
  if (!/^[1-9]\d{0,3}$/.test(pageText)) throw new SyncInputError("字段目录页码无效。");
  const page = Number(pageText), size = 50;
  const where: Prisma.AmazonFieldObservationWhereInput = { ...scope, raw: { task: { sourceId: source.id } } };
  const fieldWhere: Prisma.AmazonFieldRegistryWhereInput = { ...scope, observations: { some: where } };
  const [observedFieldCount, mappedFieldCount, sourceRegistries, incompleteScans] = await Promise.all([
    prisma.amazonFieldRegistry.count({ where: fieldWhere }),
    prisma.amazonFieldRegistry.count({ where: { ...fieldWhere, mappingStatus: "MAPPED" } }),
    prisma.amazonDataSourceRegistry.findMany({ where: { ...scope, fields: { some: fieldWhere } }, take: 101,
      select: { provider: true, sourceCode: true, apiVersion: true, sourceType: true, verificationStatus: true } }),
    prisma.amazonFieldObservation.count({ where: { ...where, scanComplete: false } }),
  ]);
  const fields = await prisma.amazonFieldRegistry.findMany({ where: { ...scope, observations: { some: where } },
    orderBy: { id: "asc" }, skip: (page - 1) * size, take: size + 1,
    include: { source: true, mappings: { orderBy: { mappingVersion: "desc" }, take: 1 },
      observations: { where, orderBy: [{ observedAt: "desc" }, { id: "desc" }], take: 1 } } });
  // Bounded page-local historical evidence. It does not certify today's mutable
  // facts, all archives, or query acceptance, even when one batch passed.
  const persistenceEvents = await prisma.auditLog.findMany({ where: { organizationId: scope.organizationId,
    action: "amazon.sync.fields.persistence-checked", entityType: "AmazonFieldRegistry", entityId: { in: fields.slice(0, size).map(field => field.id) },
    AND: [{ metadata: { path: ["workspaceId"], equals: scope.workspaceId } }, { metadata: { path: ["sourceId"], equals: source.id } }] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 501, select: { id: true, entityId: true, createdAt: true, metadata: true } });
  const rows = fields.slice(0, size).map(field => {
    const observation = field.observations[0];
    return { fieldId: field.fieldId, layer: field.layer, provider: field.source.provider, sourceCode: field.source.sourceCode, apiVersion: field.source.apiVersion,
      sourcePath: unseal(field.sourcePathCiphertext, scope, field.id, "amazon-field-path.v1").sourcePath,
      verificationStatus: field.verificationStatus, mappingStatus: field.mappingStatus,
      structuredPersistenceVerified: false, queryAcceptanceVerified: false,
      persistenceEvidenceLimit: 5, persistenceEvidenceMayBePartial: true,
      persistenceEvidence: persistenceEvents.slice(0, 500).filter(event => event.entityId === field.id).slice(0, 5).map(event => ({ id: event.id, checkedAt: event.createdAt, evidence: event.metadata })),
      // First/last occurrence here are SOURCE-local, not the shared catalogue's dates.
      latestObservedAt: observation.observedAt, observedTypes: observation.observedTypes,
      nullCount: observation.nullCount?.toString() ?? null, nonNullCount: observation.nonNullCount?.toString() ?? null,
      emptyStringCount: observation.emptyStringCount?.toString() ?? null, scanComplete: observation.scanComplete,
      rawArchive: { taskId: observation.rawTaskId, page: observation.rawPage },
      mapping: field.mappings[0] ? { version: field.mappings[0].mappingVersion, status: field.mappings[0].status, targetTable: field.mappings[0].targetTable, targetColumn: field.mappings[0].targetColumn, definition: field.mappings[0].transformRule } : null };
  });
  const currentAccess = await amazonDataAccess(scope, actor);
  if (!await prisma.amazonSyncDataSource.findFirst({ where: { AND: [scope, sourceAccessWhere(currentAccess), { id: source.id }] }, select: { id: true } })) throw new SyncInputError("字段来源访问范围已变化。", 403);
  return { sourceId, rows, persistenceEvidenceTruncated: persistenceEvents.length > 500,
    persistenceEvidenceBasis: "BOUNDED_HISTORICAL_BATCH_CHECKS_NOT_FULL_FIELD_ACCEPTANCE", pagination: { page, pageSize: size, hasMore: fields.length > size },
    coverage: { observedFields: observedFieldCount, mappedFields: mappedFieldCount, unmappedFields: observedFieldCount - mappedFieldCount,
      rawPersistedFields: observedFieldCount, structuredPersistedFields: null, queryAcceptedFields: null,
      missingOfficialFields: null, incompleteFieldObservations: incompleteScans, complete: false },
    sources: sourceRegistries.slice(0, 100).map(source => ({ ...source,
      officialContracts: registeredSpApiSchemas().filter(schema => schema.operation === source.sourceCode && (schema.apiVersion === source.apiVersion || schema.apiVersion === "report-json")),
      permissionStatus: "NOT_CHECKED", eligibilityStatus: "NOT_CHECKED" })), sourcesTruncated: sourceRegistries.length > 100,
    officialFieldCount: null, allOfficialFieldsRegistered: false, historicalArchivesScanned: false,
    statusBasis: "OBSERVED_RAW_FIELDS_ONLY", samplesIncluded: false };
}
