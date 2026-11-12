import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { hashPassword, verifyPassword, verifyPasswordAsync } from "@/lib/auth/password";

test("request-scoped authentication deduplicates reads without caching across requests or tenants", async () => {
  const previous = { database: process.env.DATABASE_URL, driver: process.env.AUTH_DRIVER, secret: process.env.AUTH_SECRET };
  const globalDb = globalThis as typeof globalThis & { prisma?: unknown };
  const previousDb = globalDb.prisma;
  Object.assign(process.env, { DATABASE_URL: "postgresql://fixture.invalid/unused", AUTH_DRIVER: "database", AUTH_SECRET: "auth-performance-fixture" });
  let sessionReads = 0, roleReads = 0, enabled = true, allowed = true;
  const queryArguments: unknown[] = [];
  globalDb.prisma = {
    userSession: { findFirst: async (args: { where: { userId: string } }) => {
      sessionReads++; queryArguments.push(args);
      const id = args.where.userId;
      return enabled ? { user: { id, email: `${id}@fixture.invalid`, name: id, status: "active", memberships: [{ role: "viewer", organizationId: `${id}-org`, organization: { name: "Fixture" } }] } } : null;
    } },
    organizationRosterRole: { findMany: async () => {
      roleReads++;
      return [{ id: "viewer", name: "Viewer", description: "", sortOrder: 0, updatedAt: new Date(allowed ? 1 : 2), permissions: { listingAi: allowed ? ["view"] : [] } }];
    } },
  };
  const request = (user: string) => {
    const payload = Buffer.from(JSON.stringify({ driver: "database", sessionId: "fixture", userId: user, token: "fixture", expiresAt: new Date(Date.now() + 60000).toISOString() })).toString("base64url");
    const signature = createHmac("sha256", process.env.AUTH_SECRET!).update(payload).digest("base64url");
    return new Request("http://fixture.invalid/api/example", { headers: { cookie: `amazon_bulk_ad_session=${payload}.${signature}` } });
  };
  try {
    const first = request("a");
    const identities = await Promise.all([getCurrentUserFromRequest(first), getCurrentUserFromRequest(first)]);
    assert.equal(sessionReads, 1);
    assert.strictEqual(identities[0], identities[1]);
    const permissions = await Promise.all([requireApiPermission("listingAi", "view", first), requireApiPermission("listingAi", "view", first)]);
    assert.ok(permissions.every(p => p.ok)); assert.equal(roleReads, 1); assert.equal(sessionReads, 1);
    assert.ok(!JSON.stringify(queryArguments).includes("passwordHash"), "session display/auth query must not fetch password hashes");
    allowed = false;
    const revoked = await requireApiPermission("listingAi", "view", request("a"));
    assert.equal(revoked.ok, false); assert.equal(!revoked.ok && revoked.response.status, 403);
    const second = await getCurrentUserFromRequest(request("b"));
    assert.equal(second?.organizationId, "b-org");
    enabled = false;
    assert.equal(await getCurrentUserFromRequest(request("a")), undefined);
  } finally {
    globalDb.prisma = previousDb;
    for (const [key, value] of [["DATABASE_URL", previous.database], ["AUTH_DRIVER", previous.driver], ["AUTH_SECRET", previous.secret]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});

test("asynchronous login password verification retains the existing scrypt contract", async () => {
  const hash = hashPassword("fixture-password");
  for (const password of ["fixture-password", "wrong-password"]) {
    assert.equal(await verifyPasswordAsync(password, hash), verifyPassword(password, hash));
  }
  assert.equal(await verifyPasswordAsync("fixture", "invalid"), false);
});
