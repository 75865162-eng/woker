import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { encryptSellfoxCredentials, decryptSellfoxCredentials, mergeSellfoxCredentials, sellfoxEncryptionReady, type SellfoxCredentialScope } from "@/lib/sellfox/credential-crypto";
import { getSellfoxCredentialStatus, resolveSellfoxCredentials, saveSellfoxCredentials, sellfoxCredentialAccess } from "@/lib/sellfox/credential-store";
import { withSellfoxCredentials, currentSellfoxCredentials } from "@/lib/sellfox/credential-context";
import { GET, PUT } from "@/app/api/integrations/sellfox/credentials/route";
import { createLocalSession } from "@/lib/auth/session";
import { sellfoxPost, closeSellfoxClient } from "@/lib/sellfox/client";
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

test("Sellfox credential scope stays isolated across concurrent async work", async () => {
  const values = await Promise.all(["scope-a", "scope-b"].map(namespace => withSellfoxCredentials({ ...credentials, namespace }, async () => {
    await setImmediate();
    return (await currentSellfoxCredentials())?.namespace;
  })));
  assert.deepEqual(values, ["scope-a", "scope-b"]);
  assert.equal(currentSellfoxCredentials(), undefined);
});

test("scoped token caches separate identical clients by workspace and credential revision", async t => {
  const previousFetch = globalThis.fetch, previousDatabase = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_800_000_000_000 });
  let tokenCount = 0;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    return url.pathname.includes("oauth")
      ? Response.json({ data: { access_token: `fixture-token-${++tokenCount}`, expires_in: 86_400_000 } })
      : Response.json({ data: { token: url.searchParams.get("access_token") } });
  };
  async function drive<T>(promise: Promise<T>) {
    let done = false;
    void promise.then(() => { done = true; }, () => { done = true; });
    for (let n = 0; n < 1_000 && !done; n++) { await setImmediate(); t.mock.timers.tick(100); }
    assert.ok(done); return promise;
  }
  const call = (namespace: string) => withSellfoxCredentials({ ...credentials, namespace }, () => sellfoxPost<{ token: string }>("/api/fixture.json", {}));
  try {
    const a = await drive(call("workspace-a:1"));
    assert.deepEqual(await drive(call("workspace-a:1")), a);
    const b = await drive(call("workspace-b:1"));
    const rotated = await drive(call("workspace-a:2"));
    assert.notEqual(a.token, b.token); assert.notEqual(a.token, rotated.token); assert.equal(tokenCount, 3);
  } finally {
    await closeSellfoxClient(); globalThis.fetch = previousFetch;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabase;
  }
});

test("credential API and repository enforce live roles, CAS, audit and no transport", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma, previousFetch = globalThis.fetch;
  const names = ["DATABASE_URL", "AUTH_DRIVER", "SELLFOX_CLIENT_ID", "SELLFOX_CLIENT_SECRET", "SELLFOX_CREDENTIAL_ENCRYPTION_KEY"] as const;
  const env = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/fixture";
  process.env.AUTH_DRIVER = "local";
  process.env.SELLFOX_CREDENTIAL_ENCRYPTION_KEY = encryptionEnvironment.SELLFOX_CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.SELLFOX_CLIENT_ID; delete process.env.SELLFOX_CLIENT_SECRET;
  let role = "owner", active = true, workspaceExists = true, rejectAudit = false;
  let record: { credentialsCiphertext: string; revision: number; updatedAt: Date } | null = null;
  const audits: unknown[] = [];
  let requests = 0;
  const db = {
    organizationMember: { findUnique: async () => ({ role, user: { status: active ? "active" : "disabled" } }) },
    workspaceScope: { findUnique: async ({ where }: { where: { organizationId_id: SellfoxCredentialScope } }) => workspaceExists && where.organizationId_id.organizationId === scope.organizationId ? { id: scope.workspaceId } : null },
    organizationRosterRole: { findMany: async () => [] },
    organizationRolePermission: { findUnique: async () => null },
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
    const scoped = await resolveSellfoxCredentials({ ...scope, workspaceId: "other-workspace" });
    assert.equal(scoped.clientId, "legacy-id"); assert.notEqual(scoped.namespace, (await resolveSellfoxCredentials(scope)).namespace);
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
