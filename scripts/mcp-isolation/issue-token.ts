/**
 * 运维工具：为当前库中第一个组织成员签发一张赛狐 MCP 凭证并打印令牌。
 * 仅用于本地联调；令牌只打印一次，用后请调用 revoke 或从设置页吊销。
 *
 * 用法：node --import ./scripts/runtime/database-bootstrap.mjs node_modules/tsx/dist/cli.mjs \
 *          scripts/mcp-isolation/issue-token.ts [name] [days]
 */
import { prisma } from "@/lib/db/prisma";
import { manageSellfoxMcpCredential } from "@/lib/sellfox/mcp";
import { sellfoxMcpToolNames } from "@/lib/sellfox/mcp-tool-registry";

async function main() {
  const name = process.argv[2] ?? "local-debug";
  const days = Number(process.argv[3] ?? 1);
  const [owner] = await prisma.$queryRaw<Array<{ organizationId: string; id: string }>>`
    SELECT m."organizationId", m."userId" AS id FROM "OrganizationMember" m ORDER BY m."createdAt" ASC LIMIT 1`;
  if (!owner) throw new Error("数据库中没有组织成员");
  const result = await manageSellfoxMcpCredential(
    { organizationId: owner.organizationId, workspaceId: "default" },
    owner.id,
    { action: "create", name, tools: [...sellfoxMcpToolNames], storeIds: [], expiresAt: new Date(Date.now() + Math.min(90, Math.max(1, days)) * 86400000).toISOString() },
  );
  console.log(JSON.stringify({ id: result.credential.id, revision: result.credential.revision, token: result.token }, null, 2));
}

main().then(() => prisma.$disconnect()).catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
