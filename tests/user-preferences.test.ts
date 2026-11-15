import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { GET, PUT } from "@/app/api/user-preferences/[key]/route";
import { createLocalSession } from "@/lib/auth/session";

test("列宽偏好使用 widths 契约、当前用户隔离、边界钳制和无库失败语义", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL;
  process.env.AUTH_DRIVER = "local";
  const context = (key = "table-columns:ads") => ({ params: Promise.resolve({ key }) });
  const values = new Map<string, unknown>();
  globals.prisma = { userPreference: {
    findUnique: async ({ where }: { where: { userId_key: { userId: string; key: string } } }) => ({ value: values.get(JSON.stringify(where.userId_key)) ?? null }),
    upsert: async ({ where, create }: { where: { userId_key: { userId: string; key: string } }; create: { userId: string; value: unknown } }) => {
      assert.equal(create.userId, where.userId_key.userId);
      values.set(JSON.stringify(where.userId_key), create.value);
      return { id: "fixture" };
    },
  } } as unknown as PrismaClient;
  async function request(userId: string, value?: unknown) {
    const session = await createLocalSession({ id: userId, organizationId: "fixture-org", organizationName: "Fixture", role: "owner", email: `${userId}@fixture.invalid`, name: "Fixture" });
    return new Request("http://localhost/api/user-preferences/table-columns:ads", { method: value === undefined ? "GET" : "PUT", headers: { cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}`, "content-type": "application/json" }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  }
  try {
    assert.equal((await GET(new Request("http://localhost/api/user-preferences/table-columns:ads"), context())).status, 401);
    const unavailable = await PUT(await request("a", { widths: { sku: 200 } }), context());
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).persisted, false);
    process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/never_connect";
    const saved = await PUT(await request("a", { widths: { sku: 1, amount: 9999, name: 123.6 } }), context());
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).value, { widths: { sku: 48, amount: 800, name: 124 } });
    assert.deepEqual((await (await GET(await request("a"), context())).json()).value, { widths: { sku: 48, amount: 800, name: 124 } });
    assert.equal((await (await GET(await request("b"), context())).json()).value, null);
    for (const value of [{ sku: 100 }, { widths: [] }, { widths: { sku: "100" } }, { widths: { "bad.key": 100 } }, { widths: null }]) {
      assert.equal((await PUT(await request("a", value), context())).status, 400);
    }
    assert.equal((await PUT(await request("a", { widths: {} }), context("bad.key"))).status, 400);
    assert.equal((await PUT(await request("a", { widths: {} }), context())).status, 200);
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
