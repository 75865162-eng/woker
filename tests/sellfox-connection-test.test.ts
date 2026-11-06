import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import type { PrismaClient } from "@prisma/client";
import { runSellfoxConnectionTest } from "@/lib/sellfox/connection-test";
import { closeSellfoxClient } from "@/lib/sellfox/client";
import { POST } from "@/app/api/integrations/sellfox/credentials/test/route";

test("connection test rejects unauthenticated and cross-origin requests", async () => {
  const url = "http://localhost/api/integrations/sellfox/credentials/test";
  assert.equal((await POST(new Request(url, { method: "POST" }))).status, 401);
  assert.equal((await POST(new Request(url, { method: "POST", headers: { origin: "https://foreign.example" } }))).status, 403);
});

test("connection test uses fresh tokens only, enforces live scope/revision/cooldown and sanitizes results", async t => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma, previousFetch = globalThis.fetch;
  const env = { DATABASE_URL: process.env.DATABASE_URL, SELLFOX_CLIENT_ID: process.env.SELLFOX_CLIENT_ID, SELLFOX_CLIENT_SECRET: process.env.SELLFOX_CLIENT_SECRET };
  delete process.env.DATABASE_URL;
  process.env.SELLFOX_CLIENT_ID = "fixture-test-id"; process.env.SELLFOX_CLIENT_SECRET = "fixture-test-secret";
  const scope = { organizationId: "org", workspaceId: "workspace" };
  let role = "owner", active = true, workspace = true, failAudit = false, changedDuringRequest = false;
  let calls = 0, tokenCode = 0, ttl = 86_400_000;
  const audits: { action: string; metadata: unknown; entityId: string; createdAt: Date }[] = [];
  const db = {
    organizationMember: { findUnique: async () => ({ role, user: { status: active ? "active" : "disabled" } }) },
    workspaceScope: { findUnique: async () => workspace ? { id: "workspace" } : null },
    organizationRosterRole: { findMany: async () => [] },
    organizationRolePermission: { findUnique: async () => null },
    $executeRaw: async () => 1,
    auditLog: {
      findFirst: async () => audits.find(a => a.action === "sellfox.credentials.test.started" && Date.now() - a.createdAt.getTime() < 60_000) ?? null,
      create: async ({ data }: { data: { action: string; metadata: unknown; entityId: string } }) => {
        if (failAudit) throw new Error("private audit error");
        audits.push({ ...data, createdAt: new Date() }); return { id: `audit-${audits.length}` };
      },
    },
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => callback(db),
  };
  globals.prisma = db as unknown as PrismaClient;
  globalThis.fetch = async input => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, "https://openapi.sellfox.com");
    assert.equal(url.pathname, "/api/oauth/v2/token.json");
    if (changedDuringRequest) process.env.SELLFOX_CLIENT_SECRET = "fixture-changed";
    return Response.json({ code: tokenCode, msg: "private-upstream-fixture-test-secret", data: { access_token: "private-fixture-token", expires_in: ttl } });
  };
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_800_000_000_000 });
  async function drive<T>(operation: Promise<T>) {
    let done = false;
    void operation.then(() => { done = true; }, () => { done = true; });
    for (let n = 0; n < 1_000 && !done; n++) { await setImmediate(); t.mock.timers.tick(100); }
    assert.ok(done); return operation;
  }
  try {
    role = "viewer"; await assert.rejects(() => runSellfoxConnectionTest(scope, "actor", 0), /无权|管理员/);
    role = "owner"; active = false; await assert.rejects(() => runSellfoxConnectionTest(scope, "actor", 0), /无权/);
    active = true; workspace = false; await assert.rejects(() => runSellfoxConnectionTest(scope, "actor", 0), /无权/);
    workspace = true;
    await assert.rejects(() => runSellfoxConnectionTest(scope, "actor", 1), /版本/);
    failAudit = true; await assert.rejects(() => runSellfoxConnectionTest(scope, "actor", 0)); failAudit = false;
    assert.equal(calls, 0);
    const success = await drive(runSellfoxConnectionTest(scope, "actor", 0));
    assert.equal(success.passed, true); assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(success), /private-fixture-token|fixture-test-secret|fixture-test-id/);
    await assert.rejects(() => runSellfoxConnectionTest(scope, "actor", 0), /频繁/);
    assert.equal(calls, 1);
    t.mock.timers.tick(61_000);
    await drive(runSellfoxConnectionTest(scope, "actor", 0));
    assert.equal(calls, 2, "connection test must bypass the cached token");
    t.mock.timers.tick(61_000); tokenCode = 40005;
    const failure = await drive(runSellfoxConnectionTest(scope, "actor", 0));
    assert.equal(failure.passed, false); assert.match(failure.message, /IP 不在白名单/);
    assert.doesNotMatch(JSON.stringify(failure), /private-upstream|fixture-test-secret/);
    t.mock.timers.tick(61_000); tokenCode = 0; ttl = 0;
    assert.equal((await drive(runSellfoxConnectionTest(scope, "actor", 0))).passed, false);
    t.mock.timers.tick(61_000); ttl = 86_400_000; changedDuringRequest = true;
    await assert.rejects(drive(runSellfoxConnectionTest(scope, "actor", 0)), /凭据已更新/);
    assert.doesNotMatch(JSON.stringify(audits), /private-fixture-token|fixture-test-secret|credentialsCiphertext/);
  } finally {
    await closeSellfoxClient(); globals.prisma = previous; globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(env)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
