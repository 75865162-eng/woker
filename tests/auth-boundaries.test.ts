import assert from "node:assert/strict";
import test from "node:test";
import { rolePermissionsCookieName } from "@/lib/accounts/permissions";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { authorizeOps, parseOpsArgs, type OpsIdentity } from "@/lib/operations/cli";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import type { Prisma } from "@prisma/client";
import { POST as register } from "@/app/api/auth/register/route";
import { getAuthSecret } from "@/lib/auth/constants";

test("所有环境必须显式配置强认证密钥且不回退固定开发密钥", () => {
  const previous = { mode: process.env.NODE_ENV, secret: process.env.AUTH_SECRET };
  try {
    for (const mode of ["development", "test", "production"]) {
      Object.assign(process.env, { NODE_ENV: mode });
      for (const secret of [undefined, "", "short", "local-development-auth-secret", "replace-with-a-random-secret-at-least-32-characters"]) {
        if (secret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = secret;
        assert.throws(() => getAuthSecret(), /AUTH_SECRET/);
      }
      process.env.AUTH_SECRET = "auth-boundary-fixture-secret-at-least-32-characters";
      assert.equal(getAuthSecret(), process.env.AUTH_SECRET);
    }
  } finally {
    if (previous.mode === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: previous.mode });
    if (previous.secret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous.secret;
  }
});

test("生产公开注册在读取请求体、数据库及创建会话前拒绝，开发首成员仅为viewer", async () => {
  const env: NodeJS.ProcessEnv = process.env;
  const keys = ["NODE_ENV", "ERP_RUNTIME_MODE", "DATABASE_URL", "AUTH_SECRET"];
  const previous = keys.map(key => env[key]);
  const globals = globalThis as typeof globalThis & { prisma?: unknown };
  const previousDb = globals.prisma;
  let databaseReads = 0;
  globals.prisma = new Proxy({}, { get() { databaseReads++; throw new Error("不应访问数据库"); } });
  try {
    for (const [nodeMode, runtimeMode] of [["production", "local"], ["development", "production"]]) {
      Object.assign(env, { NODE_ENV: nodeMode });
      env.ERP_RUNTIME_MODE = runtimeMode;
      for (const databaseUrl of [undefined, "postgresql://fixture.invalid/unused"]) {
        if (databaseUrl) env.DATABASE_URL = databaseUrl; else delete env.DATABASE_URL;
        for (const body of ["invalid-json", JSON.stringify({ email: "fixture@example.invalid", name: "测试成员", password: "fixture-password", confirmPassword: "fixture-password", role: "owner" })]) {
          const request = new Request("http://fixture.invalid/api/auth/register", { method: "POST", body });
          const response = await register(request);
          assert.equal(response.status, 403);
          assert.equal(response.headers.get("set-cookie"), null);
          assert.equal(request.bodyUsed, false);
        }
      }
    }
    assert.equal(databaseReads, 0);

    Object.assign(env, { NODE_ENV: "development" });
    env.ERP_RUNTIME_MODE = "local";
    env.DATABASE_URL = "postgresql://fixture.invalid/unused";
    env.AUTH_SECRET = "registration-boundary-test-signing-key-v3-2026";
    const roles: string[] = [];
    let sessionWrites = 0;
    const tx = {
      user: {
        findUnique: async () => null,
        create: async ({ data }: { data: { email: string; name: string; memberships: { create: { role: string } } } }) => {
          roles.push(data.memberships.create.role);
          return { id: "fixture-user", email: data.email, name: data.name, memberships: [{ role: data.memberships.create.role }] };
        },
      },
      organization: { upsert: async () => ({ id: "fixture-org", name: "测试组织" }) },
      organizationMember: { count: async () => 0 },
      organizationRosterRole: { count: async () => 0, findMany: async () => [], createMany: async () => ({ count: 0 }) },
      organizationRolePermission: { findUnique: async () => null },
      auditLog: { create: async () => ({}) },
      teamRosterMember: { upsert: async ({ create }: { create: { roleId: string } }) => { roles.push(create.roleId); return {}; } },
      $executeRaw: async () => 1,
    };
    globals.prisma = {
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
      userSession: { create: async () => { sessionWrites++; return { id: "fixture-session" }; } },
      organizationRosterRole: { findMany: async () => [] },
    };
    const response = await register(new Request("http://fixture.invalid/api/auth/register", { method: "POST", body: JSON.stringify({ email: "fixture@example.invalid", name: "测试成员", password: "fixture-password", confirmPassword: "fixture-password", role: "owner" }) }));
    assert.equal(response.status, 200, await response.text());
    assert.deepEqual(roles, ["viewer", "viewer"]);
    assert.equal(sessionWrites, 1);
    assert.ok(response.headers.get("set-cookie"));
  } finally {
    globals.prisma = previousDb;
    keys.forEach((key, index) => { if (previous[index] === undefined) delete env[key]; else env[key] = previous[index]; });
  }
});

test("workspace identifiers are checked against the organization before scoped reads", async () => {
  const identity: OpsIdentity = { organizationId: "org-a", workspaceId: "workspace-b", actorUserId: "user-a" };
  const db = {
    organizationMember: { findFirst: async () => ({ role: "staff" }), findUnique: async () => ({ role: "staff", user: { status: "active" } }) },
    workspaceMembership: { findUnique: async () => ({ userId: "user-a" }) },
    workspaceScope: { findUnique: async ({ where }: { where: { organizationId_id: { organizationId: string; id: string } } }) =>
      where.organizationId_id.organizationId === "org-a" && where.organizationId_id.id === "workspace-b" ? null : { id: "workspace-a" } },
    organizationRosterRole: { findMany: async () => [{ id: "staff", permissions: { operations: ["view"] } }] },
  } as unknown as Prisma.TransactionClient;

  await assert.rejects(() => authorizeOps(db, identity, parseOpsArgs(["freshness"])), /workspace/);
});

test("workspace access query is tenant-bound", async () => {
  const lookups: unknown[] = [];
  const client = {
    organizationMember: { findUnique: async () => ({ role: "viewer", user: { status: "active" } }) },
    workspaceScope: {
      findUnique: async (args: unknown) => { lookups.push(args); return null; },
    },
  } as never;

  assert.equal(await assertWorkspaceAccess("org-a", "forged-workspace", "user-a", client), false);
  assert.deepEqual(lookups, [{
    where: { organizationId_id: { organizationId: "org-a", id: "forged-workspace" } },
    select: { id: true },
  }]);
});

test("Amazon reads use account checks while PPC workbooks retain module permissions", async () => {
  const identity: OpsIdentity = { organizationId: "org-a", workspaceId: "workspace-a", actorUserId: "user-a" };
  const db = {
    organizationMember: { findFirst: async () => ({ role: "staff" }), findUnique: async () => ({ role: "staff", user: { status: "active" } }) },
    workspaceMembership: { findUnique: async () => ({ userId: "user-a" }) },
    workspaceScope: { findUnique: async () => ({ id: "workspace-a" }) },
    organizationRosterRole: { findMany: async () => [{ id: "staff", permissions: { workspace: ["view"] } }] },
  } as unknown as Prisma.TransactionClient;

  await authorizeOps(db, identity, parseOpsArgs(["freshness"]));
  await assert.rejects(() => authorizeOps(db, identity, parseOpsArgs(["ppc", "report-summary"])), /Missing module view permission/);
});

test("forged permission and session cookies cannot create a database-backed identity", async () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "forged-cookie-boundary-test-signing-key-v3";
  try {
    const request = new Request("https://example.test/api/operations/freshness", {
      headers: {
        cookie: `${rolePermissionsCookieName}=%7B%22owner%22%3A%7B%22operations%22%3A%5B%22view%22%5D%7D%7D; amazon_bulk_ad_session=eyJkcml2ZXIiOiJkYXRhYmFzZSJ9.forged`,
      },
    });

    assert.equal(await getCurrentUserFromRequest(request), undefined);
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
});
