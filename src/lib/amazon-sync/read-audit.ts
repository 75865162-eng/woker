import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import type { SyncScope } from "./policy";
/** Append-only access evidence. Never include arbitrary query text, payloads or tokens. */
export async function auditAmazonDataRead(scope: SyncScope, actor: string, entry: string, role?: string) {
  if (!process.env.DATABASE_URL) return;
  await prisma.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.data.read.requested", entityType: "AmazonData", metadata: { workspaceId: scope.workspaceId, requestId: randomUUID(), entry, role: role ?? null, administrator: role === "owner" || role === "database_admin" } } });
}
