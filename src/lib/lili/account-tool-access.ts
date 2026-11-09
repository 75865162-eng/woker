import { amazonMcpTools } from "@/lib/amazon-sync/mcp-tool-registry";
import { researchCredentialTools } from "./research-grants";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

const registered = [...amazonMcpTools, ...researchCredentialTools].map(([name]) => name);
type ToolCredential = { id: string; name?: string; tools: readonly string[] };
/** A display name alone never grants inheritance. Only server-issued, live OAuth
 * device records qualify; live RBAC and explicit data scopes remain mandatory. */
export async function accountToolsForLili(credential: ToolCredential, db: Prisma.TransactionClient = prisma): Promise<string[]> {
  if (!credential.name?.startsWith("Lili device: ")) return [...credential.tools];
  const grant = await db.liliOAuthGrant.findUnique({ where: { deviceId: credential.id } });
  if (!grant || grant.revokedAt || grant.expiresAt <= new Date()) return [...credential.tools];
  if (new URL(grant.resource).pathname !== "/api/lili/mcp") return [...credential.tools];
  return [...registered];
}
export async function credentialAllowsTool(credential: ToolCredential, tool: string, db: Prisma.TransactionClient = prisma): Promise<boolean> {
  return (await accountToolsForLili(credential, db)).includes(tool);
}
