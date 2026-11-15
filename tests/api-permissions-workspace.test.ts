import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { requireApiPermission } from "@/lib/auth/api-permissions";

test("API permissions validate every explicit workspace selector without trusting cookies", async () => {
  const previous = { database: process.env.DATABASE_URL, driver: process.env.AUTH_DRIVER, secret: process.env.AUTH_SECRET };
  const globalDb = globalThis as typeof globalThis & { prisma?: unknown };
  const previousDb = globalDb.prisma;
  Object.assign(process.env, { DATABASE_URL: "postgresql://fixture.invalid/unused", AUTH_DRIVER: "database", AUTH_SECRET: "api-workspace-fixture" });
  const lookups: string[] = [];
  globalDb.prisma = {
    userSession: { findFirst: async () => ({ user: { id: "user-a", email: "user@fixture.invalid", name: "User", status: "active", memberships: [{ role: "viewer", organizationId: "org-a", organization: { name: "Fixture" } }] } }) },
    organizationRosterRole: { findMany: async () => [{ id: "viewer", name: "Viewer", description: "", sortOrder: 0, updatedAt: new Date(1), permissions: { listingAi: ["view"] } }] },
    workspaceScope: { findUnique: async ({ where }: { where: { organizationId_id: { organizationId: string; id: string } } }) => {
      assert.equal(where.organizationId_id.organizationId, "org-a");
      const id = where.organizationId_id.id;
      lookups.push(id);
      return id.startsWith("allowed") ? { id } : null;
    } },
  };
  const payload = Buffer.from(JSON.stringify({ driver: "database", sessionId: "fixture", userId: "user-a", token: "fixture", expiresAt: new Date(Date.now() + 60000).toISOString() })).toString("base64url");
  const signature = createHmac("sha256", process.env.AUTH_SECRET!).update(payload).digest("base64url");
  const cookie = `amazon_bulk_ad_session=${payload}.${signature}; workspaceId=allowed-cookie`;
  const check = async (url: string, body?: object, header?: string) => {
    lookups.length = 0;
    const request = new Request(url, { method: body ? "POST" : "GET", headers: { cookie, ...(body ? { "content-type": "application/json" } : {}), ...(header === undefined ? {} : { "x-workspace-id": header }) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await requireApiPermission("listingAi", "view", request);
    return result.ok ? 200 : result.response.status;
  };

  try {
    assert.equal(await check("http://fixture.invalid/api/example?workspaceId=allowed-query", undefined, "denied-header"), 403);
    assert.deepEqual(lookups, ["allowed-query", "denied-header"]);

    assert.equal(await check("http://fixture.invalid/api/example?workspaceId=allowed-query", { workspaceId: "allowed-body", context: { workspaceId: "denied-context" }, }, "allowed-header"), 403);
    assert.deepEqual(lookups, ["allowed-body", "denied-context"]);

    assert.equal(await check("http://fixture.invalid/api/example?workspaceId=denied-query", { workspaceId: "allowed-body" }, "allowed-header"), 403);
    assert.deepEqual(lookups, ["allowed-body", "denied-query"]);

    assert.equal(await check("http://fixture.invalid/api/example?workspaceId=%20allowed-one%20&workspaceId=allowed-two", { workspaceId: " allowed-one ", context: { workspaceId: "allowed-two" } }, " allowed-one ") , 200);
    assert.deepEqual(lookups, ["allowed-one", "allowed-two"]);

    assert.equal(await check("http://fixture.invalid/api/example?workspaceId=allowed-one&workspaceId=denied-second"), 403);
    assert.deepEqual(lookups, ["allowed-one", "denied-second"]);

    assert.equal(await check("http://fixture.invalid/api/example?workspaceId=allowed-1&workspaceId=allowed-2&workspaceId=allowed-3&workspaceId=allowed-4&workspaceId=allowed-5"), 403);
    assert.deepEqual(lookups, ["allowed-1", "allowed-2", "allowed-3", "allowed-4"]);

    assert.equal(await check("http://fixture.invalid/api/example", undefined, "  "), 403);
    assert.deepEqual(lookups, [""]);
    assert.equal(await check("http://fixture.invalid/api/example", { workspaceId: 42 }), 403);
    assert.deepEqual(lookups, []);
    assert.equal(await check("http://fixture.invalid/api/example"), 200);
    assert.deepEqual(lookups, []);
  } finally {
    globalDb.prisma = previousDb;
    for (const [key, value] of [["DATABASE_URL", previous.database], ["AUTH_DRIVER", previous.driver], ["AUTH_SECRET", previous.secret]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});
