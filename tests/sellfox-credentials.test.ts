import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { encryptSellfoxCredentials, decryptSellfoxCredentials, mergeSellfoxCredentials, sellfoxEncryptionReady, type SellfoxCredentialScope } from "@/lib/sellfox/credential-crypto";
import { getSellfoxCredentialStatus, resolveSellfoxCredentials, saveSellfoxCredentials, sellfoxCredentialAccess } from "@/lib/sellfox/credential-store";
import { withSellfoxCredentialScope, currentSellfoxCredentials } from "@/lib/sellfox/credential-context";
import { GET, PUT } from "@/app/api/integrations/sellfox/credentials/route";
import { createLocalSession } from "@/lib/auth/session";
import { closeSellfoxClient, sellfoxPost } from "@/lib/sellfox/client";
import { Client } from "pg";
import { setImmediate } from "node:timers/promises";

const scope = { organizationId: "fixture-org", workspaceId: "fixture-workspace" };
const credentials = { clientId: "fixture-client", clientSecret: "fixture-secret" };
const encryptionEnvironment = { SELLFOX_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64") };

test("Sellfox AES-GCM binds provider, organization and workspace and rejects tampering", () => {
  const encrypted = encryptSellfoxCredentials(credentials, scope, encryptionEnvironment);
  assert.doesNotMatch(encrypted, /fixture-client|fixture-secret/);
  assert.notEqual(encrypted, encryptSellfoxCredentials(credentials, scope, encryptionEnvironment));
  assert.deepEqual(decryptSellfoxCredentials(encrypted, scope, encryptionEnvironment), credentials);
  for (const other of [{ ...scope, organizationId: "other" }, { ...scope, workspaceId: "other" }]) assert.throws(() => decryptSellfoxCredentials(encrypted, other, encryptionEnvironment));
  assert.throws(() => decryptSellfoxCredentials(encrypted.slice(0, -4) + "xxxx", scope, encryptionEnvironment));
  assert.throws(() => decryptSellfoxCredentials(encrypted, scope, { SELLFOX_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64") }));
  assert.equal(sellfoxEncryptionReady({ SELLFOX_CREDENTIAL_ENCRYPTION_KEY: "bad" }), false);
  assert.throws(() => encryptSellfoxCredentials(credentials, scope, {}), /主密钥/);
});

test("Sellfox updates retain omitted credentials, require first pair and bound input", () => {
  assert.deepEqual(mergeSellfoxCredentials({ clientId: "new", clientSecret: "" }, credentials), { ...credentials, clientId: "new" });
  for (const input of [null, [], { clientId: "x" }, { clientId: 1, clientSecret: "y" }, { clientId: "a\n", clientSecret: "b" }, { clientId: "a".repeat(16_385), clientSecret: "b" }]) assert.throws(() => mergeSellfoxCredentials(input, null));
  assert.throws(() => mergeSellfoxCredentials({ clientId: "", clientSecret: "" }, credentials), /请填写/);
});

test("Sellfox HTTP transport requires a resolved organization/workspace scope", async t => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previousDb = globals.prisma, previousFetch = globalThis.fetch;
  const globalEnv = { DATABASE_URL: process.env.DATABASE_URL, SELLFOX_CLIENT_ID: process.env.SELLFOX_CLIENT_ID, SELLFOX_CLIENT_SECRET: process.env.SELLFOX_CLIENT_SECRET, SELLFOX_CREDENTIAL_ENCRYPTION_KEY: process.env.SELLFOX_CREDENTIAL_ENCRYPTION_KEY, SELLFOX_RATE_LIMIT_MODE: process.env.SELLFOX_RATE_LIMIT_MODE, SELLFOX_REQUEST_SPACING_MS: process.env.SELLFOX_REQUEST_SPACING_MS, SELLFOX_RATE_LIMIT_WAIT_MS: process.env.SELLFOX_RATE_LIMIT_WAIT_MS, SELLFOX_REDIS_URL: process.env.SELLFOX_REDIS_URL, AUTH_SECRET: process.env.AUTH_SECRET };
  process.env.SELLFOX_RATE_LIMIT_WAIT_MS = "5000";
  delete process.env.SELLFOX_REDIS_URL;
  process.env.SELLFOX_RATE_LIMIT_MODE = "path";
  const tenantA = scope;
  const tenantB = { organizationId: "fixture-org-b", workspaceId: "fixture-workspace-b" };
  process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/fixture";
  process.env.SELLFOX_RATE_LIMIT_MODE = "path";
  process.env.SELLFOX_REQUEST_SPACING_MS = "1050";
  process.env.SELLFOX_CLIENT_ID = "global-client";
  process.env.SELLFOX_CLIENT_SECRET = "global-secret";
  process.env.SELLFOX_CREDENTIAL_ENCRYPTION_KEY = encryptionEnvironment.SELLFOX_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AUTH_SECRET = "sellfox-isolation-fixture-auth-secret-key-minimum-32-chars";
  const records = new Map([tenantA, tenantB].map((tenant, index) => [JSON.stringify(tenant), {
    credentialsCiphertext: encryptSellfoxCredentials({ clientId: `client-${index}`, clientSecret: `secret-${index}` }, tenant, encryptionEnvironment),
    revision: 1,
  }]));
  t.mock.method(Client.prototype, "connect", async () => undefined);
  t.mock.method(Client.prototype, "query", async () => ({ rows: [{ ok: true }] }));
  t.mock.method(Client.prototype, "end", async () => undefined);
  globals.prisma = { sellfoxIntegrationCredential: { findUnique: async ({ where }: { where: { organizationId_workspaceId: SellfoxCredentialScope } }) => records.get(JSON.stringify(where.organizationId_workspaceId)) ?? null } } as unknown as PrismaClient;
  const db = { ...globals.prisma, workspaceScope: { findUnique: async ({ where }: { where: { organizationId_id: SellfoxCredentialScope } }) => ({ id: where.organizationId_id.workspaceId }) }, organizationMember: { findUnique: async () => ({ role: "owner", user: { status: "active" } }) }, workspaceMembership: { findUnique: async () => null } } as unknown as Prisma.TransactionClient & { workspaceMembership: Prisma.TransactionClient["workspaceMembership"] };
  const requests: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input)); requests.push(url);
    return url.pathname.includes("oauth")
      ? Response.json({ data: { access_token: `token-${url.searchParams.get("client_id")}`, expires_in: 86_400_000 } })
      : Response.json({ data: { token: url.searchParams.get("access_token") } });
  };
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_800_000_000_000 });
  async function drive<T>(promise: Promise<T>): Promise<T> {
    let done = false; let value: T | undefined; let error: unknown;
    promise.then(result => { done = true; value = result; }, failure => { done = true; error = failure; });
    for (let i = 0; i < 1000 && !done; i++) { await setImmediate(); if (!done) t.mock.timers.tick(100); }
    assert.ok(done); if (error) throw error; return value as T;
  }
  try {
    await assert.rejects(drive(sellfoxPost("/api/fixture.json", {})), /未发送请求/);
    assert.equal(requests.length, 0);
    const a = await drive(withSellfoxCredentialScope(tenantA, () => sellfoxPost<{ token: string }>("/api/fixture.json", {}), db));
    const b = await drive(withSellfoxCredentialScope(tenantB, () => sellfoxPost<{ token: string }>("/api/fixture.json", {}), db));
    assert.notEqual(a.token, b.token);
    assert.deepEqual(requests.filter(url => url.pathname.includes("oauth")).map(url => url.searchParams.get("client_id")), ["client-0", "client-1"]);
    assert.equal((await drive(withSellfoxCredentialScope(tenantA, () => sellfoxPost<{ token: string }>("/api/fixture.json", {}), db))).token, a.token);
    assert.equal(requests.filter(url => url.pathname.includes("oauth")).length, 2);
  } finally {
    await closeSellfoxClient(); globals.prisma = previousDb; globalThis.fetch = previousFetch; t.mock.timers.reset();
    for (const [key, value] of Object.entries(globalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("凭证授权只使用当前catalog，旧权限表与数据库故障均不能补授权限", async () => {
  let legacyReads = 0, unavailable = false;
  const db = {
    organizationMember: { findUnique: async () => ({ role: "owner", user: { status: "active" } }) },
    workspaceScope: { findUnique: async () => ({ id: scope.workspaceId }) },
    organizationRosterRole: { findMany: async () => { if (unavailable) throw new Error("catalog unavailable"); return []; } },
    organizationRolePermission: { findUnique: async () => { legacyReads++; return { permissions: { owner: { sellfox: ["view", "create"], settings: ["edit"] } } }; } },
  };
  await assert.rejects(sellfoxCredentialAccess(scope, "actor", db as never), /无权/);
  unavailable = true;
  await assert.rejects(sellfoxCredentialAccess(scope, "actor", db as never), /catalog unavailable/);
  assert.equal(legacyReads, 0);
});

test("作用域凭据在无记录、缺表、数据库故障及未配置数据库时均禁止环境回退", async () => {
  const names = ["DATABASE_URL", "SELLFOX_CLIENT_ID", "SELLFOX_CLIENT_SECRET"] as const;
  const env = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/fixture";
  process.env.SELLFOX_CLIENT_ID = "global-client";
  process.env.SELLFOX_CLIENT_SECRET = "global-secret";
  let failure: Error | undefined;
  const reads: SellfoxCredentialScope[] = [];
  const db = { sellfoxIntegrationCredential: { findUnique: async ({ where }: { where: { organizationId_workspaceId: SellfoxCredentialScope } }) => {
    reads.push(where.organizationId_workspaceId);
    if (failure) throw failure;
    return null;
  } } };
  const other = { ...scope, organizationId: "other-org" };
  try {
    for (const error of [undefined, new Prisma.PrismaClientKnownRequestError("missing table", { code: "P2021", clientVersion: "fixture" }), new Error("database unavailable")]) {
      failure = error;
      for (const tenant of [scope, other]) {
        await assert.rejects(resolveSellfoxCredentials(tenant, db as never), error?.message === "database unavailable" ? /database unavailable/ : /尚未配置/);
        if (error?.message === "database unavailable") {
          await assert.rejects(getSellfoxCredentialStatus(tenant, db as never), /database unavailable/);
        } else {
          const status = await getSellfoxCredentialStatus(tenant, db as never);
          assert.equal(status.source, "none");
          assert.equal(status.configured, false);
          assert.equal(status.storageReady, !error);
        }
      }
    }
    assert.ok(reads.some(value => value.organizationId === scope.organizationId));
    assert.ok(reads.some(value => value.organizationId === other.organizationId));
    delete process.env.DATABASE_URL;
    const previousReads = reads.length;
    for (const tenant of [scope, other]) {
      await assert.rejects(resolveSellfoxCredentials(tenant, db as never), /尚未配置/);
      const status = await getSellfoxCredentialStatus(tenant, db as never);
      assert.equal(status.source, "none");
      assert.equal(status.configured, false);
      assert.equal(status.storageReady, false);
    }
    assert.equal(reads.length, previousReads);
  } finally {
    for (const name of names) { if (env[name] === undefined) delete process.env[name]; else process.env[name] = env[name]; }
  }
});

test("credential API and repository enforce live roles, CAS, audit and no transport", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma, previousFetch = globalThis.fetch;
  const names = ["DATABASE_URL", "AUTH_DRIVER", "AUTH_SECRET", "SELLFOX_CLIENT_ID", "SELLFOX_CLIENT_SECRET", "SELLFOX_CREDENTIAL_ENCRYPTION_KEY"] as const;
  const env = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/fixture";
  process.env.AUTH_DRIVER = "local";
  process.env.AUTH_SECRET = "sellfox-credential-fixture-signing-key-at-least-32-characters";
  process.env.SELLFOX_CREDENTIAL_ENCRYPTION_KEY = encryptionEnvironment.SELLFOX_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AUTH_SECRET = "sellfox-isolation-fixture-auth-secret-key-minimum-32-chars";
  delete process.env.SELLFOX_CLIENT_ID; delete process.env.SELLFOX_CLIENT_SECRET;
  let role = "owner", active = true, workspaceExists = true, rejectAudit = false;
  let record: { credentialsCiphertext: string; revision: number; updatedAt: Date } | null = null;
  const audits: unknown[] = [];
  let requests = 0;
  const db = {
    organizationMember: { findUnique: async () => ({ role, user: { status: active ? "active" : "disabled" } }) },
    workspaceMembership: { findUnique: async () => ({ userId: "actor" }) },
    workspaceScope: { findUnique: async ({ where }: { where: { organizationId_id: SellfoxCredentialScope } }) => workspaceExists && where.organizationId_id.organizationId === scope.organizationId ? { id: scope.workspaceId } : null },
    organizationRosterRole: { findMany: async () => [{ id: "owner", name: "组织管理员", description: "测试角色", sortOrder: 0, updatedAt: new Date(0), permissions: { sellfox: ["view", "create"], settings: ["edit"] } }] },
    organizationRolePermission: { findUnique: async () => { throw new Error("不能读取旧权限表"); } },
    sellfoxIntegrationCredential: {
      findUnique: async ({ where }: { where: { organizationId_workspaceId: SellfoxCredentialScope } }) => where.organizationId_workspaceId.organizationId === scope.organizationId && where.organizationId_workspaceId.workspaceId === scope.workspaceId ? record : null,
      create: async ({ data }: { data: { credentialsCiphertext: string; revision: number } }) => { record = { ...data, updatedAt: new Date() }; },
      updateMany: async ({ where, data }: { where: { revision: number }; data: { credentialsCiphertext: string; revision: number } }) => {
        if (record?.revision !== where.revision) return { count: 0 };
        record = { ...record, ...data, updatedAt: new Date() }; return { count: 1 };
      },
    },
    auditLog: { create: async (input: unknown) => { if (rejectAudit) throw new Error("private-database-error"); audits.push(input); } },
    $executeRaw: async () => 1,
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => {
      const previousRecord = structuredClone(record), previousAudits = audits.length;
      try { return await callback(db); }
      catch (error) { record = previousRecord; audits.splice(previousAudits); throw error; }
    },
  };
  globals.prisma = db as unknown as PrismaClient;
  globalThis.fetch = async () => { requests++; throw new Error("network forbidden"); };
  const session = await createLocalSession({ id: "actor", organizationId: scope.organizationId, organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
  function request(method: string, body?: unknown, origin = "http://localhost") {
    return new Request("http://localhost/api/integrations/sellfox/credentials", { method, headers: { origin, "x-workspace-id": scope.workspaceId, "content-type": "application/json", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  try {
    assert.equal((await GET(new Request("http://localhost/api/integrations/sellfox/credentials"))).status, 401);
    assert.equal((await PUT(request("PUT", { ...credentials, revision: 0 }, "https://foreign.example"))).status, 403);
    let response: Response = await GET(request("GET"));
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).canEdit, true);
    role = "viewer";
    assert.equal((await PUT(request("PUT", { ...credentials, revision: 0 }))).status, 403);
    role = "owner"; active = false;
    assert.equal((await PUT(request("PUT", { ...credentials, revision: 0 }))).status, 403);
    active = true; workspaceExists = false;
    await assert.rejects(() => sellfoxCredentialAccess(scope, "actor"));
    workspaceExists = true;
    process.env.SELLFOX_CLIENT_ID = "legacy-id"; process.env.SELLFOX_CLIENT_SECRET = "legacy-secret";
    for (const submitted of [{ clientId: "new-id", clientSecret: "" }, { clientId: "", clientSecret: "new-secret" }]) {
      await assert.rejects(saveSellfoxCredentials(scope, "actor", submitted, 0), /请填写 Client/);
      assert.equal(record, null);
      assert.equal(audits.length, 0);
    }
    response = await PUT(request("PUT", { ...credentials, revision: 0 }));
    assert.equal(response.status, 200); assert.equal((await response.json()).revision, 1);
    assert.equal(audits.length, 1); assert.doesNotMatch(JSON.stringify(audits), /fixture-client|fixture-secret|credentialsCiphertext/);
    response = await GET(request("GET"));
    const publicStatus = await response.json();
    assert.equal(publicStatus.configured, true); assert.equal(publicStatus.source, "database");
    assert.doesNotMatch(JSON.stringify(publicStatus), /fixture-client|fixture-secret|credentialsCiphertext/);
    assert.deepEqual(await saveSellfoxCredentials(scope, "actor", { clientId: "new-id", clientSecret: "" }, 1), { revision: 2 });
    assert.equal((await resolveSellfoxCredentials(scope)).clientSecret, credentials.clientSecret);
    await assert.rejects(() => saveSellfoxCredentials(scope, "actor", credentials, 1), /更新/);
    rejectAudit = true;
    await assert.rejects(() => saveSellfoxCredentials(scope, "actor", credentials, 2));
    assert.equal((await getSellfoxCredentialStatus(scope)).revision, 2);
    rejectAudit = false;
    process.env.SELLFOX_CLIENT_ID = "legacy-id"; process.env.SELLFOX_CLIENT_SECRET = "legacy-secret";
    for (const tenant of [{ ...scope, workspaceId: "other-workspace" }, { ...scope, organizationId: "other-org" }]) {
      await assert.rejects(resolveSellfoxCredentials(tenant), /尚未配置/);
      const status = await getSellfoxCredentialStatus(tenant);
      assert.equal(status.source, "none"); assert.equal(status.configured, false);
      await assert.rejects(withSellfoxCredentialScope(tenant, () => sellfoxPost("/api/fixture.json", {})), /未发送请求/);
    }
    assert.equal((await resolveSellfoxCredentials(scope)).clientSecret, credentials.clientSecret);
    delete process.env.SELLFOX_CREDENTIAL_ENCRYPTION_KEY;
    assert.equal((await getSellfoxCredentialStatus(scope)).configured, false);
    await assert.rejects(() => resolveSellfoxCredentials(scope), /主密钥/);
    await assert.rejects(() => saveSellfoxCredentials(scope, "actor", credentials, 2), /主密钥/);
    assert.equal(requests, 0);
  } finally {
    globals.prisma = previous; globalThis.fetch = previousFetch;
    for (const name of names) { if (env[name] === undefined) delete process.env[name]; else process.env[name] = env[name]; }
  }
});
