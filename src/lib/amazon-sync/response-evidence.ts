import { recordReportParseEvidence } from "./report-parse-evidence";
import { createHash } from "node:crypto";
import { registerArchivedFields } from "./field-registry";
import type { AmazonSyncRun, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { digest, seal, unseal } from "./approval-policy";
import { rawResponseEnvelope } from "./raw-fields";
import { SyncInputError } from "./policy";

type Identity = { operation: string; [key: string]: Prisma.InputJsonValue | null };

/** Uses the existing raw archive. The caller holds its scope lock and execution
 * fence. Evidence commits before parsing; business facts and cursors still commit
 * together. A parser/transaction failure must not force another Amazon request. */
export async function archiveResponse(tx: Prisma.TransactionClient, run: AmazonSyncRun, page: number, identity: Identity, rawBody: string) {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const bodySha256 = digest(rawBody);
  const existing = await tx.amazonSyncRawPage.findUnique({ where: { taskId_page: { taskId: run.id, page } } });
  if (existing) {
    if (!responseArchiveHashMatches(rawBody, existing.bodySha256) || digest(existing.requestMetadata) !== digest(identity)) throw new SyncInputError("响应归档身份冲突，原件与检查点保留。", 409);
    await registerArchivedFields(tx, run, page, rawBody, "JSON");
    return;
  }
  await tx.amazonSyncRawPage.create({ data: { ...scope, taskId: run.id, page, resource: run.resource, requestMetadata: identity,
    rawCiphertext: seal(rawResponseEnvelope(rawBody, identity.operation, typeof identity.apiVersion === "string" ? identity.apiVersion : undefined), scope, `${run.id}:${page}`, `amazon-${run.resource}-raw.v1`), bodySha256, capturedAt: new Date() } });
  await registerArchivedFields(tx, run, page, rawBody, "JSON");
  if (run.resource === "finance" && page > 0 && identity.apiVersion === "2024-06-19" && identity.operation === "listTransactions") await recordReportParseEvidence(tx, run, { rawTaskId: run.id, rawPage: page, phase: "ARCHIVED", rowsCommitted: 0, checkedAt: new Date() });
  if (run.resource === "orders" && page > 0 && identity.apiVersion === "2026-01-01" && ["searchOrders", "getOrder"].includes(identity.operation)) await recordReportParseEvidence(tx, run, { rawTaskId: run.id, rawPage: page, phase: "ARCHIVED", rowsCommitted: 0, checkedAt: new Date(), replayed: false });
}

export async function replayResponse(run: AmazonSyncRun, page: number, identity: Identity, db: Pick<Prisma.TransactionClient, "amazonSyncRawPage"> = prisma): Promise<string | null> {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const original = await db.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: run.id, page, resource: run.resource } });
  if (!original) return null;
  if (digest(original.requestMetadata) !== digest(identity)) throw new SyncInputError("响应归档与当前请求范围不匹配。", 409);
  const raw = unseal(original.rawCiphertext, scope, `${run.id}:${page}`, `amazon-${run.resource}-raw.v1`).rawBody;
  if (typeof raw !== "string" || !responseArchiveHashMatches(raw, original.bodySha256)) throw new SyncInputError("响应原件完整性校验失败。", 409);
  return raw;
}

/** Earlier archives hashed decoded UTF-8 bytes; newer archives hashed the
 * canonical string. Both bind the exact original text, never parsed JSON. */
export function responseArchiveHashMatches(raw: string, expected: string) {
  return digest(raw) === expected || createHash("sha256").update(raw, "utf8").digest("hex") === expected;
}
