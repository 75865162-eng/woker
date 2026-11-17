import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { withSellfoxCredentialScope } from "@/lib/sellfox/credential-context";
import { encryptSellfoxCredentials } from "@/lib/sellfox/credential-crypto";
import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { Client } from "pg";

test("Sellfox HTTP client uses official token, signature, retry and queue contracts without network", async (t) => {
  const previousFetch = globalThis.fetch;
  const previousEnv = { DATABASE_URL: process.env.DATABASE_URL, SELLFOX_CLIENT_ID: process.env.SELLFOX_CLIENT_ID, SELLFOX_CLIENT_SECRET: process.env.SELLFOX_CLIENT_SECRET, SELLFOX_CREDENTIAL_ENCRYPTION_KEY: process.env.SELLFOX_CREDENTIAL_ENCRYPTION_KEY, AUTH_SECRET: process.env.AUTH_SECRET, SELLFOX_RATE_LIMIT_MODE: process.env.SELLFOX_RATE_LIMIT_MODE, SELLFOX_REQUEST_SPACING_MS: process.env.SELLFOX_REQUEST_SPACING_MS };
  delete process.env.SELLFOX_CLIENT_ID;
  delete process.env.SELLFOX_CLIENT_SECRET;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/fixture";
  t.mock.method(Client.prototype, "connect", async () => undefined);
  t.mock.method(Client.prototype, "query", async () => ({ rows: [{ ok: true }] }));
  t.mock.method(Client.prototype, "end", async () => undefined);
  process.env.SELLFOX_RATE_LIMIT_MODE = "path";
  process.env.SELLFOX_REQUEST_SPACING_MS = "1050";
  process.env.AUTH_SECRET = "sellfox-client-fixture-auth-secret-at-least-32-characters";
  process.env.SELLFOX_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const credentialEnv = process.env.SELLFOX_CREDENTIAL_ENCRYPTION_KEY;
  const tenant = { organizationId: "fixture-org-client-test", workspaceId: "fixture-workspace-client-test" };
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previousPrisma = globals.prisma;
  let revision = 1, credentialSecret = "fixture-secret";
  const encrypted = () => encryptSellfoxCredentials({ clientId: "fixture-client", clientSecret: credentialSecret }, tenant, { SELLFOX_CREDENTIAL_ENCRYPTION_KEY: credentialEnv! });
  let credentialsCiphertext = encrypted();
  globals.prisma = { sellfoxIntegrationCredential: { findUnique: async ({ where }: { where: { organizationId_workspaceId: typeof tenant } }) => where.organizationId_workspaceId.organizationId === tenant.organizationId && where.organizationId_workspaceId.workspaceId === tenant.workspaceId ? { credentialsCiphertext, revision } : null } } as unknown as PrismaClient;
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_800_000_000_000 });
  const db = { sellfoxIntegrationCredential: { findUnique: async ({ where }: { where: { organizationId_workspaceId: typeof tenant } }) => where.organizationId_workspaceId.organizationId === tenant.organizationId && where.organizationId_workspaceId.workspaceId === tenant.workspaceId ? { credentialsCiphertext, revision } : null }, workspaceScope: { findUnique: async () => ({ id: tenant.workspaceId }) }, organizationMember: { findUnique: async () => ({ role: "owner", user: { status: "active" } }) }, workspaceMembership: { findUnique: async () => null } } as unknown as Prisma.TransactionClient & { workspaceMembership: Prisma.TransactionClient["workspaceMembership"] };
  const { sellfoxPost, closeSellfoxClient } = await import("@/lib/sellfox/client");
  const runScoped = <T>(operation: () => Promise<T>) => withSellfoxCredentialScope(tenant, operation, db);
  type Call = { url: URL; init?: RequestInit; at: number };
  let calls: Call[] = [];
  let respond: (call: Call) => unknown = () => ({ data: { accepted: true } });
  let tokenTtl: unknown = 86_400_000;
  let tokenCount = 0;
  let tokenCode = 0;
  globalThis.fetch = async (input, init) => {
    const call = { url: new URL(String(input)), init, at: Date.now() };
    calls.push(call);
    if (call.url.pathname.includes("/api/oauth/")) {
      tokenCount += 1;
      return Response.json({ code: tokenCode, data: { access_token: `fixture-token-${tokenCount}`, expires_in: tokenTtl } });
    }
    const value = await respond(call);
    if (value instanceof Error) throw value;
    return value instanceof Response ? value : Response.json(value);
  };
  async function drive<T>(operation: Promise<T>): Promise<T> {
    let done = false;
    let result: T | undefined;
    let failure: unknown;
    operation.then((value) => { done = true; result = value; }, (error) => { done = true; failure = error; });
    for (let i = 0; i < 1000 && !done; i += 1) {
      await setImmediate();
      if (!done) t.mock.timers.tick(100);
    }
    assert.ok(done, "mock HTTP operation should finish within the bounded retry budget");
    if (failure) throw failure;
    return result as T;
  }
  function reset() {
    t.mock.timers.tick(2 * 86_400_000);
    calls = []; tokenTtl = 86_400_000; tokenCount = 0; tokenCode = 0;
    credentialSecret = "fixture-secret"; revision += 1; credentialsCiphertext = encrypted();
    respond = () => ({ code: 0, data: { accepted: true } });
  }
  try {
    await t.test("one cached token serves concurrent paths; same path is spaced by the rate bucket", async () => {
      reset();
      const starts: number[] = []; const ends: number[] = [];
      const slowRespond = async (call: Call) => {
        starts.push(call.at);
        const query = call.url.searchParams;
        const values = { access_token: query.get("access_token"), client_id: "fixture-client", method: "post", nonce: query.get("nonce"), timestamp: query.get("timestamp"), url: call.url.pathname };
        const source = Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&");
        assert.equal(query.get("sign"), createHmac("sha256", "fixture-secret").update(source).digest("hex"));
        assert.equal(call.init?.method, "POST");
        assert.equal(call.init?.body, JSON.stringify({ shopIdList: ["shop-a"] }));
        // Simulate a slow response so spacing is measured from completion.
        await new Promise((resolve) => setTimeout(resolve, 500));
        ends.push(Date.now());
        return { data: { accepted: true } };
      };
      respond = slowRespond;
      // 限流按接口 path 分桶：不同接口并行，不再全局串行（赛狐每接口 1 req/s）。
      await withSellfoxCredentialScope(tenant, async () => drive(Promise.all([sellfoxPost("/api/test/a.json", { shopIdList: ["shop-a"] }), sellfoxPost("/api/test/b.json", { shopIdList: ["shop-a"] })])), db);
      assert.equal(tokenCount, 1);
      assert.equal(calls.length, 3);
      assert.ok(Math.abs(starts[1] - starts[0]) < 1100, "不同 path 应并行发出");
      assert.ok(starts[1] - ends[0] < 1100, "不同 path 不等待彼此响应完成");
      // 同一 path 仍串行且至少间隔一个限流窗口。
      reset();
      respond = slowRespond;
      starts.length = 0; ends.length = 0;
      await withSellfoxCredentialScope(tenant, async () => drive(Promise.all([sellfoxPost("/api/test/a.json", { shopIdList: ["shop-a"] }), sellfoxPost("/api/test/a.json", { shopIdList: ["shop-a"] })])), db);
      assert.equal(starts.length, 2);
      assert.ok(starts[1] - starts[0] >= 1100, "同一 path 至少间隔 1.1 秒");
      assert.ok(starts[1] >= ends[0], "同一 path 等待前一次响应完成");
    });
    await t.test("expires_in is milliseconds; expired cache refreshes without a 1000x extension", async () => {
      reset(); tokenTtl = 10_000;
      await runScoped(async () => drive(sellfoxPost("/api/test.json", {})));
      await runScoped(async () => drive(sellfoxPost("/api/test.json", {})));
      assert.equal(tokenCount, 1);
      t.mock.timers.tick(10_000);
      await runScoped(async () => drive(sellfoxPost("/api/test.json", {})));
      assert.equal(tokenCount, 2);
    });
    await t.test("zero, missing and invalid TTLs never send a business API request", async () => {
      for (const ttl of [0, undefined, -1, "86400000"]) {
        reset(); tokenTtl = ttl;
        await assert.rejects(withSellfoxCredentialScope(tenant, async () => drive(sellfoxPost("/api/test.json", {})), db), /毫秒有效期/);
        assert.equal(calls.length, 1);
      }
    });
    await t.test("40001 refreshes and signs with the replacement token only once", async () => {
      reset();
      let attempts = 0;
      respond = () => ++attempts === 1 ? { code: 40001 } : { data: { accepted: true } };
      await runScoped(async () => drive(sellfoxPost("/api/test.json", {})));
      assert.equal(tokenCount, 2);
      const businessCalls = calls.filter((call) => !call.url.pathname.includes("/api/oauth/"));
      assert.notEqual(businessCalls[0].url.searchParams.get("access_token"), businessCalls[1].url.searchParams.get("access_token"));
      reset(); respond = () => ({ code: 40001 });
      await assert.rejects(withSellfoxCredentialScope(tenant, async () => drive(sellfoxPost("/api/test.json", {})), db), /40001/);
      assert.equal(tokenCount, 2);
      assert.equal(calls.length, 4);
    });
    await t.test("rate limits use bounded exponential backoff and never expose upstream messages", async () => {
      reset(); respond = () => ({ code: 40019, msg: "private upstream credentials" });
      await assert.rejects(withSellfoxCredentialScope(tenant, async () => drive(sellfoxPost("/api/test.json", {})), db), (error: Error) => error.message.includes("40019") && !error.message.includes("private"));
      const attempts = calls.filter((call) => !call.url.pathname.includes("/api/oauth/"));
      assert.equal(attempts.length, 4);
      for (let i = 1; i < attempts.length; i += 1) assert.ok(attempts[i].at - attempts[i - 1].at >= 2000 * 2 ** (i - 1));
    });
    await t.test("permanent parameter, permission, whitelist and signature errors are not retried", async () => {
      for (const code of [40005, 40011, 40014, 40021]) {
        reset(); respond = () => ({ code, msg: "private upstream credentials" });
        await assert.rejects(withSellfoxCredentialScope(tenant, async () => drive(sellfoxPost("/api/test.json", {})), db), (error: Error) => error.message.includes(String(code)) && !error.message.includes("private") && (code !== 40005 || error.message.includes("白名单")));
        assert.equal(calls.length, 2);
      }
      reset(); tokenCode = 40005;
      await assert.rejects(withSellfoxCredentialScope(tenant, async () => drive(sellfoxPost("/api/test.json", {})), db), /40005/);
      assert.equal(calls.length, 1);
    });
    await t.test("network and non-JSON 503 responses retry; non-JSON success fails closed", async () => {
      reset();
      let attempts = 0;
      respond = () => {
        attempts += 1;
        if (attempts === 1) return new Error("private network URL");
        if (attempts === 2) return new Response("temporary outage", { status: 503 });
        return { data: { accepted: true } };
      };
      assert.deepEqual(await runScoped(async () => drive(sellfoxPost("/api/test.json", {}))), { accepted: true });
      assert.equal(attempts, 3);
      reset(); respond = () => new Response("invalid upstream body");
      await assert.rejects(withSellfoxCredentialScope(tenant, async () => drive(sellfoxPost("/api/test.json", {})), db), /非 JSON/);
      assert.equal(calls.length, 2);
    });
    await t.test("task creation transport is sent once when the result is ambiguous", async () => {
      reset(); respond = () => new Error("private timeout URL");
      await assert.rejects(withSellfoxCredentialScope(tenant, async () => drive(sellfoxPost("/api/cpc/download/createTask.json", {}, { retry: false })), db));
      assert.equal(calls.filter((call) => call.url.pathname.includes("createTask")).length, 1);
    });
  } finally {
    await closeSellfoxClient();
    globalThis.fetch = previousFetch;
    globals.prisma = previousPrisma;
    t.mock.timers.reset();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
