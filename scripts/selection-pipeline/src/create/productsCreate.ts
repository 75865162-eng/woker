import { nextSku } from "@/components/products/product-workbench-utils";
import { PipelineError } from "../io";
import type { Draft } from "../types";
import { inspectQuality, assertWriteQuality } from "../quality";
import { selectionDir } from "../config";
// No database imports are loaded by the dry-run path.
export async function productsCreate(draft: Draft, workspaceId: string) {
  if (draft.fixture) throw new PipelineError("FIXTURE_WRITE_FORBIDDEN");
  const organizationId = process.env.SELECTION_ORGANIZATION_ID;
  const actorUserId = process.env.SELECTION_ACTOR_USER_ID;
  if (!process.env.DATABASE_URL || !organizationId || !actorUserId) throw new PipelineError("WRITE_REQUIRES_DATABASE_AND_EXPLICIT_ACTOR");
  if (!/^[a-f0-9-]{36}$/i.test(draft.product.id)) throw new PipelineError("INVALID_DRAFT_ID");
  if (draft.schemaVersion !== 1 || draft.product.status !== "pending" || !draft.brief.keyword || draft.product.sku !== "DRAFT") throw new PipelineError("INVALID_OR_ALREADY_CREATED_DRAFT");
  assertWriteQuality(await inspectQuality(selectionDir(draft.slug), draft, false, workspaceId));
  const { prisma } = await import("@/lib/db/prisma");
  const { saveProductAggregate } = await import("@/lib/products/product-aggregate-service");
  try {
    const result = await prisma.$transaction(async tx => {
      const actor = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId: actorUserId } }, include: { user: { select: { id: true, name: true, status: true } } } });
      if (!actor || actor.user.status !== "active" || !["owner","database_admin"].includes(actor.role)) throw new PipelineError("WRITE_REQUIRES_ACTIVE_ORGANIZATION_OWNER_OR_DATABASE_ADMIN");
      // Serialize this CLI's SKU allocation. Other callers remain protected by the unique SKU key.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}),hashtext(${workspaceId}))::text`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}),hashtext(${draft.product.id}))::text`;
      const prior = await tx.productRecord.findFirst({ where: { organizationId, payload: { path: ["selectionPipeline", "draftId"], equals: draft.product.id } } });
      if (prior) {
        if (prior.organizationId !== organizationId || prior.workspaceId !== workspaceId) throw new PipelineError("DRAFT_ID_SCOPE_CONFLICT");
        return { product: { sku: prior.sku, id: prior.id, revision: prior.revision }, outboxEventId: "", projectionEventId: "" };
      }
      const existing = await tx.productRecord.findMany({ where: { organizationId,workspaceId }, select: { sku: true } });
      const sku = nextSku(existing);
      const workspace = await tx.workspaceScope.findUnique({ where: { organizationId_id: { organizationId, id: workspaceId } } });
      // Aggregate save upserts WorkspaceScope: preserve its existing account/marketplace metadata.
      const scope = { organizationId, workspaceId, accountId: workspace?.accountId ?? "", marketplace: workspace?.marketplace ?? "" };
      return saveProductAggregate(tx, { scope, user: { id: actor.user.id, name: actor.user.name, organizationId }, existingRecord: null,
        product: {
          ...draft.product, sku, selectionOwner: actor.user.name, developer: actor.user.name,
          selectionPipeline: { draftId: draft.product.id, slug: draft.slug, keyword: draft.brief.keyword, version: 1 },
        } as typeof draft.product & { selectionPipeline: { draftId: string; slug: string; keyword: string; version: number } } });
    });
    // Process the durable events through the existing handler. No Redis connection is needed.
    // Retry must recover pending events even if a prior CLI crashed after the database commit.
    const events = await prisma.productOutboxEvent.findMany({ where: { organizationId, workspaceId, entityType: "product", OR: [{ entityId: result.product.id }, { entityId: result.product.sku }], status: { in: ["queued", "failed"] } }, select: { id: true } });
    const { processProductOutboxEvent } = await import("@/lib/products/product-outbox");
    const queued = await Promise.allSettled(events.map(event => processProductOutboxEvent(event.id)));
    const pending = await prisma.productOutboxEvent.count({ where: { organizationId, workspaceId, entityType: "product", OR: [{ entityId: result.product.id }, { entityId: result.product.sku }], status: { not: "done" } } });
    return { sku: result.product.sku, productId: result.product.id, revision: result.product.revision, outboxEventId: result.outboxEventId, projectionEventId: result.projectionEventId, queuePending: pending > 0 || queued.some(r => r.status === "rejected") };
  } finally { await prisma.$disconnect(); }
}
