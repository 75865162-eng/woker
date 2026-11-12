import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { assertAmazonAction, assertAmazonScopeAdmin } from "./data-access";
import type { SyncScope } from "./policy";

/** Call only in the transaction creating an account, never to renew an old grant. */
export async function assignNewAutomaticAccount(tx: Prisma.TransactionClient, scope: SyncScope, actor: string, sellerAccountId: string) {
  await assertAmazonScopeAdmin(scope, actor, tx);
  await assertAmazonAction(scope, actor, "create", tx);
  await assertAmazonAction(scope, actor, "approve", tx);
  const grant = await tx.amazonDataAccessGrant.create({ data: { ...scope, id: randomUUID(), userId: actor, sellerAccountId, actions: ["view", "sync", "export", "edit"], marketplaceIds: [], mcpEnabled: false } });
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.sync.account.automatic_assigned", entityType: "AmazonDataAccessGrant", entityId: grant.id, metadata: { workspaceId: scope.workspaceId, sellerAccountId, basis: "NEW_ACCOUNT_AUTHORIZATION", revision: grant.revision } } });
}
