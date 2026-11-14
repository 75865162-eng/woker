/**
 * Seed Sellfox Open API credentials into the encrypted credential store.
 *
 * Usage:
 *   node --import ./scripts/runtime/database-bootstrap.mjs node_modules/tsx/dist/cli.mjs \
 *     scripts/sellfox-credentials-seed.ts \
 *     --organization-id=ID --workspace-id=default --actor-user-id=ID \
 *     [--client-id=...] [--client-secret=...]
 *
 * Credentials fall back to SELLFOX_CLIENT_ID / SELLFOX_CLIENT_SECRET.
 * Only a masked summary is printed; secrets never reach stdout.
 */
import { getSellfoxCredentialStatus, saveSellfoxCredentials } from "@/lib/sellfox/credential-store";
import { prisma } from "@/lib/db/prisma";

function parseArgs(argv: string[]) {
  const out = new Map<string, string>();
  const allowed = new Set(["organization-id", "workspace-id", "actor-user-id", "client-id", "client-secret"]);
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match || !allowed.has(match[1]) || out.has(match[1])) throw new Error(`参数无效或重复：${arg}`);
    out.set(match[1], match[2].trim());
  }
  return out;
}

function mask(value: string) {
  if (!value) return "(empty)";
  return value.length <= 6 ? "*".repeat(value.length) : `${value.slice(0, 4)}***${value.slice(-2)}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const organizationId = options.get("organization-id");
  const workspaceId = options.get("workspace-id") ?? "default";
  const actorUserId = options.get("actor-user-id");
  if (!organizationId || !actorUserId) throw new Error("必须显式指定 --organization-id 与 --actor-user-id。");
  const clientId = options.get("client-id") ?? process.env.SELLFOX_CLIENT_ID?.trim() ?? "";
  const clientSecret = options.get("client-secret") ?? process.env.SELLFOX_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) throw new Error("缺少 client id / secret。");

  const scope = { organizationId, workspaceId };
  const before = await getSellfoxCredentialStatus(scope);
  const saved = await saveSellfoxCredentials(scope, actorUserId, { clientId, clientSecret }, before.revision);
  const after = await getSellfoxCredentialStatus(scope);
  console.log(JSON.stringify({
    organizationId, workspaceId, actorUserId,
    before: { configured: before.configured, source: before.source, revision: before.revision },
    after: { configured: after.configured, source: after.source, revision: saved.revision, encryptionReady: after.encryptionReady },
    clientId: mask(clientId),
  }, null, 1));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "unknown" }));
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
