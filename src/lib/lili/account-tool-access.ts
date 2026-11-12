import { amazonMcpToolDefinitions, amazonMcpTools } from "@/lib/amazon-sync/mcp-tool-registry";
import { researchCredentialTools } from "./research-grants";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

export const amazonAccountReadTools = amazonMcpToolDefinitions.filter(tool => tool.operationMode === "READ_ONLY").map(tool => tool.name);
const withAccountReads = (tools: readonly string[]) => [...new Set([...tools, ...amazonAccountReadTools])];
const registered = [...amazonMcpTools, ...researchCredentialTools].map(([name]) => name);
type ToolCredential = { id: string; name?: string; tools: readonly string[] };
/** Amazon reads inherit live account assignments; OAuth inheritance of other
 * capabilities still requires a live server-issued device grant. */
export async function accountToolsForLili(credential: ToolCredential, db: Prisma.TransactionClient = prisma): Promise<string[]> {
  if (!credential.name?.startsWith("Lili device: ")) return withAccountReads(credential.tools);
  const grant = await db.liliOAuthGrant.findUnique({ where: { deviceId: credential.id } });
  if (!grant || grant.revokedAt || grant.expiresAt <= new Date()) return withAccountReads(credential.tools);
  if (new URL(grant.resource).pathname !== "/api/lili/mcp") return withAccountReads(credential.tools);
  return withAccountReads(registered);
}
export async function credentialAllowsTool(credential: ToolCredential, tool: string, db: Prisma.TransactionClient = prisma): Promise<boolean> {
  return (await accountToolsForLili(credential, db)).includes(tool);
}
