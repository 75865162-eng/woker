import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/db/prisma";
import { PpcReadError } from "../src/lib/operations/ppc-read";
import { OpsError, opsHelp, parseOpsArgs, opsIdentity, authorizeOps, runOpsCommand, formatOpsOutput } from "../src/lib/operations/cli";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || !args.length) { console.log(opsHelp); return; }
  // Same server-side env loading as Next; never prints configuration or credentials.
  loadEnvConfig(process.cwd());
  const input = parseOpsArgs(args);
  const identity = opsIdentity(input, process.env);
  if (!process.env.DATABASE_URL) throw new OpsError("DATABASE_REQUIRED", "DATABASE_URL is required.", 4);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await authorizeOps(tx, identity, input);
    return runOpsCommand(tx, identity, input);
  }, { timeout: 30000, isolationLevel: "RepeatableRead" });
  console.log(formatOpsOutput(result, input.json));
}
main().catch((error: unknown) => {
  const known = error instanceof OpsError || error instanceof PpcReadError;
  const payload = { error: { code: known ? error.code : "READ_FAILED", message: known ? error.message : "本地数据库读取/分析失败；请检查数据、连接及权限。未执行 Amazon 写入。" } };
  console.error(process.argv.includes("--json") ? JSON.stringify(payload) : `${payload.error.code}: ${payload.error.message}`);
  process.exitCode = known ? error.exitCode : 4;
}).finally(async () => { if (process.env.DATABASE_URL) await prisma.$disconnect(); });
