// Run through scripts/runtime/database-bootstrap.mjs. Defaults to read-only preview.
import { parseArgs } from "node:util";
import { prisma } from "../../src/lib/db/prisma";
import { readMarketCallQuota, setMarketCallBalance } from "../../src/lib/lili/call-quota-server";

async function main() {
  const { values } = parseArgs({ options: {
    "organization-id": { type: "string" }, "user-id": { type: "string" }, "actor-user-id": { type: "string" },
    balance: { type: "string" }, "expected-balance": { type: "string" }, "request-key": { type: "string" }, note: { type: "string" }, apply: { type: "boolean", default: false },
  } });
  const organizationId = values["organization-id"], userId = values["user-id"], actorUserId = values["actor-user-id"];
  if (!organizationId || !userId || !actorUserId || values.balance === undefined || values["expected-balance"] === undefined || !values["request-key"] || !values.note) throw new Error("Provide explicit organization, user, actor, balance, expected-balance, request-key and note.");
  const scope = { organizationId, userId };
  const input = { actorUserId, balance: Number(values.balance), expectedBalance: Number(values["expected-balance"]), requestKey: values["request-key"], note: values.note };
  const before = await readMarketCallQuota(scope);
  if (!values.apply) { console.log(JSON.stringify({ dryRun: true, scope, balance: before.balance, proposedBalance: input.balance, delta: input.balance - before.balance })); return; }
  const result = await setMarketCallBalance(scope, input);
  const after = await readMarketCallQuota(scope);
  console.log(JSON.stringify({ ...result, verifiedBalance: after.balance, latestEntryId: after.entries[0]?.id }));
}
main().catch(error => { console.error(error instanceof Error && /^(INVALID_QUOTA_GRANT|QUOTA_GRANT_FORBIDDEN|STALE_QUOTA_BALANCE)$/.test(error.message) ? error.message : "QUOTA_MAINTENANCE_FAILED"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
