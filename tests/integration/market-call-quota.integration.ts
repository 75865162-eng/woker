import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { marketCallQuota, readMarketCallQuota, setMarketCallBalance } from "@/lib/lili/call-quota-server";
import { syncRosterLoginUsers } from "@/lib/accounts/roster-auth-sync";
import { ensureMemberCallAccount } from "@/lib/accounts/member-call-account";

test("real PostgreSQL quota: grant audit, concurrent shared balance, replay, refund and tenant isolation", async () => {
  const connectionString = process.env.MARKET_QUOTA_TEST_DATABASE_URL!;
  const url = new URL(connectionString);
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/market_quota_fixture");
  assert.equal(process.env.DATABASE_URL, undefined, "Real credentials must not be inherited");
  const client = new pg.Client({ connectionString });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  await client.connect();
  try {
    await client.query(`CREATE TYPE "UserStatus" AS ENUM ('active','disabled');
      CREATE TYPE "OrganizationRole" AS ENUM ('owner','viewer');
      CREATE TABLE "User" (id TEXT PRIMARY KEY,status "UserStatus" NOT NULL,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL DEFAULT '',"passwordHash" TEXT NOT NULL DEFAULT '',"lastLoginAt" TIMESTAMP,"createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE "OrganizationMember" (id TEXT PRIMARY KEY,"organizationId" TEXT,"userId" TEXT REFERENCES "User"(id),role "OrganizationRole","createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("organizationId","userId"));
      CREATE TABLE "AuditLog" (id TEXT PRIMARY KEY,"organizationId" TEXT,"userId" TEXT,action TEXT,"entityType" TEXT,"entityId" TEXT,metadata JSONB,"createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO "User" (id,status,email) VALUES ('owner','active','owner@fixture.invalid'),('other','active','other@fixture.invalid');
      INSERT INTO "OrganizationMember" (id,"organizationId","userId",role) VALUES ('member-1','fixture','owner','owner'),('member-2','fixture','other','viewer'),('member-3','other-org','owner','owner');`);
    await client.query(await readFile("prisma/migrations/20261107040000_market_call_quota/migration.sql", "utf8"));
    const scope = { organizationId: "fixture", userId: "owner" };
    const grant = { actorUserId: "owner", balance: 3, expectedBalance: 0, requestKey: "fixture-initial", note: "Isolated test allowance" };
    assert.deepEqual(await setMarketCallBalance(scope, grant, db), { balance: 3, applied: true });
    assert.deepEqual(await setMarketCallBalance(scope, grant, db), { balance: 3, applied: false });
    assert.equal((await client.query('SELECT count(*)::int as count FROM "AuditLog"')).rows[0].count, 1);
    await assert.rejects(setMarketCallBalance(scope, { ...grant, actorUserId: "other", requestKey: "forbidden" }, db), /QUOTA_GRANT_FORBIDDEN/);
    await assert.rejects(setMarketCallBalance(scope, { ...grant, requestKey: "stale" }, db), /STALE_QUOTA_BALANCE/);
    const quota = marketCallQuota(scope, db);
    const requests = Array.from({ length: 12 }, (_, i) => ({ callId: `call-${i}`, runId: `run-${i}`, workspaceId: `workspace-${i % 2}`, provider: i % 2 ? "xiyou" as const : "sellersprite" as const, tool: "fixture_read" }));
    const results = await Promise.allSettled(requests.map(request => quota.reserve(request)));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 3);
    assert.equal((await readMarketCallQuota(scope, 1, db)).balance, 0);
    const saved = (await readMarketCallQuota(scope, 1, db)).entries.filter(entry => entry.kind === "CALL");
    assert.equal(saved.length, 3);
    await Promise.all(Array.from({ length: 8 }, () => quota.settle(saved[0].callId!, "REFUNDED")));
    let summary = await readMarketCallQuota(scope, 1, db);
    assert.equal(summary.balance, 1); assert.equal(summary.used, 2);
    await assert.rejects(quota.reserve(requests.find(request => request.callId === saved[0].callId)!), /MARKET_QUOTA_REPLAY_BLOCKED/);
    await quota.settle(saved[1].callId!, "UNKNOWN"); await quota.settle(saved[2].callId!, "COMPLETED");
    summary = await readMarketCallQuota(scope, 1, db);
    assert.equal(summary.pending, 1); assert.equal(summary.balance, 1);
    assert.equal(summary.entries.find(entry => entry.callId === saved[0].callId)?.delta, 0);
    for (const other of [{ organizationId: "fixture", userId: "other" }, { organizationId: "other-org", userId: "owner" }]) {
      assert.equal((await readMarketCallQuota(other, 1, db)).entries.length, 0);
      await assert.rejects(marketCallQuota(other, db).reserve(requests[0]), /MARKET_QUOTA_EXHAUSTED/);
      await assert.rejects(marketCallQuota(other, db).settle(saved[1].callId!, "REFUNDED"), /MARKET_QUOTA_UNAVAILABLE/);
    }
    await assert.rejects(client.query('UPDATE "MarketCallAccount" SET balance=-1'), /check constraint/);
    assert.equal((await readMarketCallQuota(scope, 2, db)).entries.length, 0);

    // Exercise the actual colleague creation path, not a parallel copy of its writes.
    const colleague = { id: "new-colleague", name: "Fixture colleague", email: "new@fixture.invalid", status: "active" as const, roleId: "viewer" as const, organizationId: "fixture" };
    await db.$transaction(tx => syncRosterLoginUsers(tx, [colleague]));
    const colleagueScope = { organizationId: "fixture", userId: colleague.id };
    assert.equal(await db.marketCallAccount.count({ where: colleagueScope }), 1);
    assert.equal((await readMarketCallQuota(colleagueScope, 1, db)).balance, 0);
    await setMarketCallBalance(colleagueScope, { ...grant, balance: 2, requestKey: "colleague-grant" }, db);
    await db.$transaction(tx => syncRosterLoginUsers(tx, [{ ...colleague, name: "Edited fixture", status: "disabled" }]));
    assert.equal((await readMarketCallQuota(colleagueScope, 1, db)).balance, 2, "editing/disabling cannot reset a ledger");
    assert.equal((await readMarketCallQuota(colleagueScope, 1, db)).entries.length, 1);
    assert.equal((await readMarketCallQuota(scope, 1, db)).balance, 1, "colleague balance cannot change the owner's balance");

    // New membership + zero ledger must succeed or roll back together.
    await client.query(`ALTER TABLE "MarketCallAccount" ADD CONSTRAINT fixture_reject_account CHECK ("userId"<>'rejected-colleague')`);
    await assert.rejects(db.$transaction(tx => syncRosterLoginUsers(tx, [{ ...colleague, id: "rejected-colleague", email: "reject@fixture.invalid" }])));
    assert.equal(await db.organizationMember.count({ where: { userId: "rejected-colleague" } }), 0);
    assert.equal(await db.user.count({ where: { id: "rejected-colleague" } }), 0);

    const registered = await db.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: "registered@fixture.invalid", name: "Fixture registration", passwordHash: "fixture-only",
        memberships: { create: { organizationId: "fixture", role: "viewer" } } } });
      await ensureMemberCallAccount(tx, { organizationId: "fixture", userId: user.id });
      return user;
    });
    assert.equal(await db.marketCallAccount.count({ where: { organizationId: "fixture", userId: registered.id, balance: 0 } }), 1);
    await syncRosterLoginUsers(db, [{ ...colleague, id: "standalone-colleague", email: "standalone@fixture.invalid" }]);
    assert.equal(await db.marketCallAccount.count({ where: { organizationId: "fixture", userId: "standalone-colleague", balance: 0 } }), 1);
  } finally { await db.$disconnect(); await client.end(); }
});
