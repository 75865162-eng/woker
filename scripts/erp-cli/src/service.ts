import type { Prisma } from "@prisma/client";
import { findProductRecordBySku } from "@/lib/products/product-record-repository";
import { saveProductAggregate } from "@/lib/products/product-aggregate-service";
import { defaultRolePermissionMap, roleCanPerformAction } from "@/lib/accounts/permissions";
import { normalizeRolePermissionMap, normalizeRolePermissions } from "@/lib/accounts/role-permissions-utils";
import { assertProductStatusTransition } from "@/lib/products/status-machine";
import { prisma } from "@/lib/db/prisma";
import { processProductOutboxEvent } from "@/lib/products/product-outbox";
import type { Product } from "@/lib/products/types";
import type { NormalizedDraft } from "./schema";

export type ErpResult = { ok: boolean; dryRun: boolean; sku: string; productId?: string; errors: string[]; warnings: string[]; product?: unknown };
export type ErpIdentity = { organizationId: string; actorUserId: string };

function envValue(name: string, alias: string) { return process.env[name]?.trim() || process.env[alias]?.trim() || ""; }

export function erpIdentity(): ErpIdentity {
  const organizationId = envValue("ERP_ORGANIZATION_ID", "SELECTION_ORGANIZATION_ID");
  const actorUserId = envValue("ERP_ACTOR_USER_ID", "SELECTION_ACTOR_USER_ID");
  if (!process.env.DATABASE_URL || !organizationId || !actorUserId) throw new Error("UNAUTHORIZED: DATABASE_URL, ERP_ORGANIZATION_ID and ERP_ACTOR_USER_ID are required");
  return { organizationId, actorUserId };
}

async function authorize(tx: Prisma.TransactionClient, identity: ErpIdentity, action: "create" | "edit" | "view") {
  const member = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: identity.organizationId, userId: identity.actorUserId } }, include: { user: { select: { id: true, name: true, status: true } } } });
  if (!member || member.user.status !== "active") throw new Error("FORBIDDEN: active organization member required");
  // Same catalog/legacy/default precedence as the web permission model, without
  // getOrganizationRolePermissions' lazy role seeding (dry-run must never write).
  const roles = await tx.organizationRosterRole.findMany({ where: { organizationId: identity.organizationId } });
  const legacy = roles.length ? null : await tx.organizationRolePermission.findUnique({ where: { organizationId: identity.organizationId } });
  const permissions = roles.length
    ? Object.fromEntries(roles.map(role => [role.id, { ...(defaultRolePermissionMap[role.id] ?? {}), ...normalizeRolePermissions(role.permissions) }]))
    : normalizeRolePermissionMap(legacy?.permissions);
  if (!roleCanPerformAction(member.role, "products", action, permissions)) throw new Error(`FORBIDDEN: products:${action} permission required`);
  return member;
}

export async function runUpsert(draft: NormalizedDraft, dryRun: boolean): Promise<ErpResult> {
  const identity = erpIdentity();
  const warnings = [...draft.warnings];
  const result = await prisma.$transaction(async (tx) => {
    const existing = await findProductRecordBySku(tx, { organizationId: identity.organizationId, workspaceId: draft.workspaceId }, draft.sku);
    const member = await authorize(tx, identity, existing ? "edit" : "create");
    if (!existing && draft.providedProductKeys.includes("id")) throw new Error("PRODUCT_ID_SERVER_ASSIGNED: omit id when creating a product");
    if (!existing && draft.product.revision !== undefined) throw new Error("REVISION_CONFLICT: product does not exist");
    const workspace = await tx.workspaceScope.findUnique({ where: { organizationId_id: { organizationId: identity.organizationId, id: draft.workspaceId } } });
    if (workspace?.marketplace && workspace.marketplace !== draft.marketplace) throw new Error("WORKSPACE_MARKETPLACE_CONFLICT");
    if (workspace?.accountId && draft.accountId && workspace.accountId !== draft.accountId) throw new Error("WORKSPACE_ACCOUNT_CONFLICT");
    if (existing && draft.product.revision !== undefined && draft.product.revision !== existing.revision) throw new Error("REVISION_CONFLICT: load latest product before retrying");
    if (existing && draft.providedProductKeys.includes("id") && draft.product.id !== existing.id) throw new Error("PRODUCT_ID_CONFLICT");
    const existingMetaValue = (existing?.payload as Record<string, unknown> | undefined)?.meta;
    const draftMetaValue = (draft.product as unknown as Record<string, unknown>).meta;
    const existingMeta = existingMetaValue && typeof existingMetaValue === "object" && !Array.isArray(existingMetaValue) ? existingMetaValue as Record<string, unknown> : {};
    const draftMeta = draftMetaValue && typeof draftMetaValue === "object" && !Array.isArray(draftMetaValue) ? draftMetaValue as Record<string, unknown> : {};
    const product = existing
      ? {
          ...(existing.payload as Record<string, unknown>),
          ...Object.fromEntries(draft.providedProductKeys.map((key) => [key, (draft.product as unknown as Record<string, unknown>)[key]])),
          ...(draft.providedProductKeys.includes("meta") ? {
            meta: {
              ...existingMeta,
              ...draftMeta,
            },
          } : {}),
          id: existing.id,
          sku: draft.sku,
        }
      : draft.product;
    const typedProduct = product as Product;
    assertProductStatusTransition((existing?.payload as Product | undefined)?.status, typedProduct.status);
    if (["listed", "canceled"].includes(typedProduct.status) && !typedProduct.conclusionExcelFile?.id) throw new Error("CONCLUSION_EXCEL_REQUIRED");
    if (dryRun) return { existing, member, saved: null };
    const saved = await saveProductAggregate(tx, {
      product: product as Product,
      user: { id: identity.actorUserId, name: member.user.name, organizationId: identity.organizationId },
      scope: { organizationId: identity.organizationId, workspaceId: draft.workspaceId, accountId: draft.accountId || workspace?.accountId || "", marketplace: draft.marketplace },
      existingRecord: existing,
      expectedRevision: existing?.revision,
    });
    return { existing, member, saved };
  });
  if (dryRun) return { ok: true, dryRun: true, sku: draft.sku, productId: result.existing?.id, errors: [], warnings };
  if (!result.saved) throw new Error("WRITE_FAILED");
  try {
    const events = await prisma.productOutboxEvent.findMany({ where: { organizationId: identity.organizationId, workspaceId: draft.workspaceId, entityType: "product", OR: [{ entityId: result.saved.product.id }, { entityId: draft.sku }], status: { in: ["queued", "failed"] } }, select: { id: true } });
    const processed = await Promise.allSettled(events.map((event) => processProductOutboxEvent(event.id)));
    const pending = await prisma.productOutboxEvent.count({ where: { organizationId: identity.organizationId, workspaceId: draft.workspaceId, entityType: "product", entityId: draft.sku, status: { not: "done" } } });
    if (pending || processed.some((item) => item.status === "rejected")) warnings.push("OUTBOX_PROCESSING_PENDING");
  } catch { warnings.push("OUTBOX_PROCESSING_PENDING"); }
  return { ok: true, dryRun: false, sku: draft.sku, productId: result.saved.product.id, errors: [], warnings };
}

export async function getProduct(sku: string, workspaceId: string): Promise<ErpResult> {
  const identity = erpIdentity();
  const result = await prisma.$transaction(async (tx) => {
    const member = await authorize(tx, identity, "view");
    const record = await findProductRecordBySku(tx, { organizationId: identity.organizationId, workspaceId }, sku);
    return { member, record };
  });
  return { ok: Boolean(result.record), dryRun: false, sku, productId: result.record?.id, errors: result.record ? [] : ["NOT_FOUND"], warnings: [], product: result.record?.payload };
}
