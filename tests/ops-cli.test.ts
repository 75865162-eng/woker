import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { authorizeOps, formatOpsOutput, opsIdentity, parseOpsArgs, runOpsCommand } from "@/lib/operations/cli";
import { suggestPpc } from "@/lib/operations/ppc-read";

const identity = { organizationId: "org", workspaceId: "ws", actorUserId: "actor" };
const calls: Array<{ table: string; args: Record<string, unknown> }> = [];
const readOnlyDb = new Proxy({}, { get: (_, table: string) => new Proxy({}, { get: (_, method: string) => async (args: Record<string, unknown>) => {
  assert.ok(["findFirst", "findMany", "findUnique", "aggregate"].includes(method), `unexpected database mutation: ${method}`);
  calls.push({ table, args });
  if (table === "workspaceDataset") return null;
  if (table === "amazonSyncRun" && method === "findFirst") return { id: "run-1", finishedAt: new Date("2026-10-24T00:00:00Z") };
  if (method === "aggregate") return { _sum: { fulfillableQuantity: 4 }, _count: { _all: 1 } };
  return method === "findMany" ? [] : null;
} }) }) as Prisma.TransactionClient;

test("all CLI commands smoke with scoped, read-only local DB calls", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("CLI must never call external HTTP"); };
  try {
    for (const args of [["freshness"], ["inventory", "list", "--sku", "ABC", "--page", "2"], ["inventory", "summary"], ["catalog", "list"], ["metrics", "daily", "--from", "2026-10-01", "--to", "2026-10-24"], ["sync", "runs", "--resource", "inventory", "--status", "SUCCEEDED"], ["ppc", "report-summary"], ["ppc", "suggest"]]) {
      calls.length = 0;
      const output = await runOpsCommand(readOnlyDb, identity, parseOpsArgs(args), new Date("2026-10-24T02:00:00Z"));
      assert.ok(output);
      for (const call of calls) {
        const where = call.args.where as Record<string, unknown>;
        assert.equal(where.organizationId, "org"); assert.equal(where.workspaceId, "ws");
      }
      assert.doesNotThrow(() => JSON.parse(formatOpsOutput(output, true)));
      assert.ok(formatOpsOutput(output, false).length);
    }
  } finally { globalThis.fetch = oldFetch; }
});
test("CLI rejects invalid commands, filters, dates and unbound identities", () => {
  for (const args of [["inventory", "delete"], ["freshness", "--wat", "1"], ["inventory", "list", "--page", "NaN"], ["freshness", "--sku", "A"], ["metrics", "daily", "--from", "2026-02-30"], ["metrics", "daily", "--from", "2026-01-01", "--to", "2026-10-24"], ["sync", "runs", "--resource", "fake"], ["sync", "runs", "--status", "FAKE"], ["metrics", "daily", "--sku", "A", "--asin", "B"]]) assert.throws(() => parseOpsArgs(args));
  assert.throws(() => opsIdentity(parseOpsArgs(["freshness"]), {}), /Configure/);
  assert.throws(() => opsIdentity(parseOpsArgs(["freshness", "--workspace", "other"]), { OPS_CLI_ORGANIZATION_ID: "org", OPS_CLI_ACTOR_USER_ID: "actor", OPS_CLI_WORKSPACE_IDS: "ws" }));
  assert.deepEqual(opsIdentity(parseOpsArgs(["freshness", "--workspace=ws"]), { OPS_CLI_ORGANIZATION_ID: "org", OPS_CLI_ACTOR_USER_ID: "actor", OPS_CLI_WORKSPACE_IDS: "ws" }), identity);
});
test("CLI daily metrics keep missing facts null", async () => {
  const result = await runOpsCommand(readOnlyDb, identity, parseOpsArgs(["metrics", "daily"]));
  assert.equal((result as { missingFields: { tacos: null } }).missingFields.tacos, null);
});
test("CLI authorization requires active membership, workspace and current module grants without role seeding", async () => {
  let active = true; let workspace = true; let grants = ["operations", "workspace", "agents"];
  const db = {
    organizationMember: { findFirst: async () => active ? { role: "staff" } : null },
    workspaceScope: { findUnique: async () => workspace ? { id: "ws" } : null },
    organizationRosterRole: { findMany: async () => [{ id: "staff", permissions: Object.fromEntries(grants.map((key) => [key, ["view"]])) }] },
  } as unknown as Prisma.TransactionClient;
  await authorizeOps(db, identity, parseOpsArgs(["ppc", "suggest"]));
  grants = ["operations"]; await assert.rejects(() => authorizeOps(db, identity, parseOpsArgs(["ppc", "suggest"])), /Missing module/);
  active = false; await assert.rejects(() => authorizeOps(db, identity, parseOpsArgs(["freshness"])), /Active/);
  active = true; workspace = false; await assert.rejects(() => authorizeOps(db, identity, parseOpsArgs(["freshness"])), /workspace/);
});
test("PPC suggestions reuse real analytics and warn on stale inventory/unknown ads date without external calls", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { assert.fail("PPC suggestion must not make HTTP requests"); });
  const now = new Date("2026-10-25T00:00:00Z");
  const result = await suggestPpc(readOnlyDb, identity, {
    id: "dataset", createdAt: new Date("2026-10-01"), marketplace: "US", campaignGroups: [],
    performanceRows: [{ id: "row", campaignGroupId: "group", campaignName: "Campaign", adGroupName: "Ad Group", keyword: "keyword", target: "keyword", matchType: "exact", currentBid: 1, spend: 15, sales: 0, clicks: 25, impressions: 100, orders: 0, batchId: "batch" }] as never,
  }, now);
  assert.equal(result.mode, "draft_only");
  assert.equal(result.externalWriteAttempted, false);
  assert.ok(result.report);
  assert.equal(result.inventoryFreshness, "STALE");
  assert.ok(result.report.evidence.some((evidence) => evidence.dataSource === "Local PPC"));
  assert.ok(result.freshnessWarnings.some((warning) => warning.includes("库存 STALE")));
  assert.ok(Array.isArray(result.adjustmentDrafts));
  assert.ok(result.freshnessWarnings.some((warning) => warning.includes("UNKNOWN")));
});

test("PPC local reader never fills missing metrics/bids with invented defaults", async () => {
  const { validateLocalPpcRows, readPpcDataset } = await import("@/lib/operations/ppc-read");
  assert.throws(() => validateLocalPpcRows([{ id: "row", campaignGroupId: "group", spend: 10 }]), /不能用默认数字/);
  const db = { workspaceDataset: { findFirst: async (args: { select: { rowCount?: boolean } }) => args.select.rowCount ? { id: "large", rowCount: 10001 } : null } } as unknown as Prisma.TransactionClient;
  await assert.rejects(() => readPpcDataset(db, identity), /10000/);
});
