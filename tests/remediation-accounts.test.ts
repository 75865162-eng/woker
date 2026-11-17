import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { randomBytes, scryptSync } from "node:crypto";
import ts from "typescript";
import {
  getAccessiblePathOrFallback,
  getFirstAccessiblePath,
  roleCanAccessModule,
  roleCanPerformAction,
  type RolePermissionMap,
} from "@/lib/accounts/permissions";
import { evaluateRateLimit, loginRateLimit, loginRateLimitKeys } from "@/lib/auth/login-rate-limit";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

function loadModule<T>(file: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const sandbox = {
    exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `未声明的依赖：${name}`);
      return dependencies[name];
    },
    process: { env: {} as Record<string, string> },
    console: { warn: () => {}, log: () => {} },
    setTimeout,
    Buffer,
  };
  runInNewContext(compiled, sandbox);
  return exports as T;
}

test("权限判定对 null/未映射模块 fail-closed，而不是无条件放行", () => {
  const full: RolePermissionMap = { owner: { products: ["view", "edit"], workspace: ["view"] } };
  assert.equal(roleCanAccessModule("owner", null), false);
  assert.equal(roleCanAccessModule("owner", null, full), false);
  assert.equal(roleCanPerformAction("owner", null, "view"), false);
  assert.equal(roleCanPerformAction("owner", null, "view", full), false);

  // 显式白名单路径（根路径）仍可达，但不映射任何模块的路径不再绕过授权。
  assert.equal(getAccessiblePathOrFallback("/", "operations"), "/");
  assert.equal(getFirstAccessiblePath("operations"), "/");
  assert.equal(getAccessiblePathOrFallback("/not-a-module", "operations"), "/");
});

test("登录限流在 count === limit 时即拒绝（>= 边界）", () => {
  assert.equal(
    evaluateRateLimit(loginRateLimit.perIdentity - 1, 60_000, loginRateLimit.perIdentity, loginRateLimit.windowSeconds).allowed,
    true,
  );
  const boundary = evaluateRateLimit(loginRateLimit.perIdentity, 60_000, loginRateLimit.perIdentity, loginRateLimit.windowSeconds);
  assert.equal(boundary.allowed, false);
  assert.equal(boundary.retryAfterSeconds, 60);
});

test("账号级限流有独立窗口且不包含明文标识", () => {
  const keys = loginRateLimitKeys("203.0.113.9", "Ops@Example.com");
  assert.ok(keys.account);
  assert.notEqual(keys.account, keys.identity);
  assert.notEqual(keys.account, keys.ip);
  assert.deepEqual(keys, loginRateLimitKeys("203.0.113.9", "ops@example.com"));
  const serialized = JSON.stringify(keys);
  assert.ok(!serialized.includes("203.0.113.9"));
  assert.ok(!serialized.includes("Ops@Example.com"));
  assert.ok(loginRateLimit.perAccount > 0);
});

test("seed-admin 不覆盖已存在账号的密码哈希，仅首次创建时写入", async () => {
  const hashBefore = "scrypt:existing:do-not-touch";
  let createCalled = false;
  const users = [{ id: "u1", email: "admin@example.com", passwordHash: hashBefore }];
  const membership = { role: "viewer" };
  const roster = { roleId: "viewer", status: "disabled" };
  const prisma = {
    organization: { upsert: async () => ({ id: "org1" }) },
    user: {
      findUnique: async () => users[0],
      create: async () => { createCalled = true; throw new Error("已存在账号不应被创建"); },
    },
    organizationMember: { upsert: async ({ update }: { update: Record<string, unknown> }) => { Object.assign(membership, update); return membership; } },
    teamRosterMember: { upsert: async ({ update }: { update: Record<string, unknown> }) => { Object.assign(roster, update); return roster; } },
    auditLog: { create: async () => ({}) },
    $disconnect: async () => {},
  };
  const source = readFileSync(new URL("../scripts/seed-admin.mjs", import.meta.url), "utf8");
  const stripped = source.replace(/^import .*?;$/gm, "");
  await runInNewContext(`(async () => { ${stripped} })()`, {
    PrismaPg: class {},
    PrismaClient: class { constructor() { return prisma; } },
    randomBytes,
    scryptSync,
    process: {
      env: {
        DATABASE_URL: "postgresql://fixture.invalid/unused",
        BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
        BOOTSTRAP_ADMIN_PASSWORD: "strong-password-123",
      },
    },
    console: { log: () => {} },
  });
  assert.equal(createCalled, false);
  assert.equal(users[0].passwordHash, hashBefore);
  assert.deepEqual(membership, { role: "viewer" });
  assert.deepEqual(roster, { roleId: "viewer", status: "disabled" });
});

test("多组织登录需要明确选择，单组织自动选中且不返回权限地图", async () => {
  let userQuery: Record<string, unknown> | undefined;
  const cookieSets: Array<{ name: string; options: Record<string, unknown> }> = [];
  const createdSessionUsers: Array<Record<string, unknown>> = [];
  const sessionCookie = { name: "amazon_bulk_ad_session", value: "signed", options: { httpOnly: true } };
  const rolePermissionsCookie = {
    name: "amazon_bulk_ad_role_permissions",
    value: "encoded",
    options: { secure: true, maxAge: 60 * 60 * 24 },
  };
  const deps: Record<string, unknown> = {
    "next/server": {
      NextResponse: {
        json: (body: unknown, init?: unknown) => {
          const response = Response.json(body as object, init as ResponseInit);
          Object.defineProperty(response, "cookies", {
            value: {
              set: (name: string, _value: string, options: Record<string, unknown>) => {
                cookieSets.push({ name, options });
              },
            },
          });
          return response;
        },
      },
    },
    "@/lib/auth/constants": { getAuthDriver: () => "database" },
    "@/lib/auth/session": {
      createLocalSession: async () => ({ sessionCookie }),
      createSession: async (_id: string, currentUser: Record<string, unknown>) => { createdSessionUsers.push(currentUser); return { sessionCookie, rolePermissionsCookie }; },
      isSecureRequest: () => false,
    },
    "@/lib/auth/password": { verifyPasswordAsync: async () => true },
    "@/lib/server/performance": { measureServerOperation: async (_name: string, fn: () => unknown) => fn() },
    "@/lib/accounts/role-permissions-server": {
      getOrganizationRolePermissionsSnapshot: async () => ({
        permissions: { owner: { products: ["view", "edit"] } },
        revision: "rev-1",
      }),
    },
    "@/lib/db/is-database-unavailable-error": { isDatabaseUnavailableError: () => false },
    "@/lib/auth/login-rate-limit": {
      peekLoginRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
      recordLoginFailure: async () => ({ allowed: true, retryAfterSeconds: 0 }),
      clearLoginFailures: async () => {},
      LoginRateLimitUnavailableError: class extends Error {},
    },
    "@/lib/auth/request-security": {
      getTrustedClientIp: () => "203.0.113.9",
      RequestSecurityConfigurationError: class extends Error {},
    },
    "@/lib/db/prisma": {
      prisma: {
        user: {
          findFirst: async (query: Record<string, unknown>) => {
            userQuery = query;
            return {
              id: "u1",
              email: "owner@example.com",
              name: "Owner",
              status: "active",
              passwordHash: "hash",
              memberships: [{ organizationId: "org-1", role: "owner", organization: { name: "Org One" } }],
            };
          },
          update: async () => ({}),
        },
        teamRosterMember: { updateMany: async () => ({ count: 0 }) },
      },
    },
  };
  const { POST } = loadModule<typeof import("@/app/api/auth/login/route")>("src/app/api/auth/login/route.ts", deps);
  const response = await POST(new Request("http://fixture.invalid/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "owner@example.com", password: "correct-password" }),
  }));
  assert.equal(response.status, 200, await response.clone().text());
  const payload = await response.json() as Record<string, unknown>;
  assert.equal("rolePermissions" in payload, false);
  assert.equal(payload.rolePermissionsRevision, "rev-1");
  assert.equal(cookieSets.some((cookie) => cookie.name === "amazon_bulk_ad_role_permissions"), true);

  const memberships = (userQuery?.select as Record<string, unknown>)?.memberships as Record<string, unknown>;
  assert.equal("take" in memberships, false);
  assert.equal("orderBy" in memberships, true);
  assert.equal(cookieSets.some((cookie) => cookie.name === "amazon_bulk_ad_session"), true);
  assert.equal(createdSessionUsers[0].organizationId, "org-1");

  const orgs = [{ organizationId: "org-1", role: "owner", organization: { name: "Org One" } }, { organizationId: "org-2", role: "viewer", organization: { name: "Org Two" } }];
  const prisma = (deps["@/lib/db/prisma"] as { prisma: { user: { findFirst: (query: Record<string, unknown>) => Promise<unknown> } } }).prisma;
  prisma.user.findFirst = async () => ({ id: "u1", email: "owner@example.com", name: "Owner", status: "active", passwordHash: "hash", memberships: orgs });
  const ambiguous = await POST(new Request("http://fixture.invalid/api/auth/login", { method: "POST", body: JSON.stringify({ email: "owner@example.com", password: "correct-password" }) }));
  assert.equal(ambiguous.status, 409);
  const choice = await ambiguous.json() as { organizations: Array<{ id: string; name: string }>; rolePermissions?: unknown };
  assert.deepEqual(choice.organizations, [{ id: "org-1", name: "Org One" }, { id: "org-2", name: "Org Two" }]);
  assert.equal("rolePermissions" in choice, false);
  assert.equal(createdSessionUsers.length, 1);

  const selected = await POST(new Request("http://fixture.invalid/api/auth/login", { method: "POST", body: JSON.stringify({ email: "owner@example.com", password: "correct-password", organizationId: "org-2" }) }));
  assert.equal(selected.status, 200);
  assert.equal(createdSessionUsers[1].organizationId, "org-2");
  const invalid = await POST(new Request("http://fixture.invalid/api/auth/login", { method: "POST", body: JSON.stringify({ email: "owner@example.com", password: "correct-password", organizationId: "org-x" }) }));
  assert.equal(invalid.status, 403);
  assert.equal(createdSessionUsers.length, 2);
});

test("数据库 session 绑定签名组织并在该组织撤权后失效", async () => {
  const queries: Array<Record<string, unknown>> = [];
  const deps: Record<string, unknown> = {
    "node:crypto": await import("node:crypto"),
    "next/headers": { cookies: async () => ({ get: () => undefined, delete: () => {} }) },
    react: { cache: (fn: unknown) => fn },
    "@/lib/server/performance": { measureServerOperation: async (_name: string, fn: () => unknown) => fn() },
    "@/lib/db/prisma": { prisma: { userSession: { findFirst: async (query: Record<string, unknown>) => {
      queries.push(query);
      const where = (query.select as Record<string, unknown>).user as { select: { memberships: { where: { organizationId: string } } } };
      return { user: { id: "u1", email: "u@example.invalid", name: "User", status: "active", memberships: where.select.memberships.where.organizationId === "org-2" ? [{ role: "viewer", organizationId: "org-2", organization: { name: "Org Two" } }] : [] } };
    } } } },
    "@/lib/auth/constants": { getAuthDriver: () => "database", getAuthSecret: () => "fixture-secret-at-least-32-characters-long", sessionCookieName: "session", sessionMaxAgeSeconds: 3600 },
    "@/lib/accounts/permissions": { rolePermissionsCookieName: "permissions" },
    "@/lib/accounts/role-permissions-server": { getOrganizationRolePermissionsSnapshot: async () => ({ permissions: {}, revision: "r1" }) },
    "@/lib/auth/request-security": { isSecureRequest: () => false },
  };
  const source = readFileSync(new URL("../src/lib/auth/session.ts", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("session.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === "getCurrentUserFromPayload");
  assert.ok(declaration);
  const compiled = ts.transpileModule(declaration.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const getCurrentUserFromPayload = runInNewContext(`${compiled}; getCurrentUserFromPayload`, {
    getAuthDriver: () => "database", hashToken: () => "hashed-token",
    measureServerOperation: (_name: string, operation: () => unknown) => operation(), prisma: (deps["@/lib/db/prisma"] as { prisma: unknown }).prisma,
  }) as (payload: object) => Promise<{ organizationId: string } | undefined>;
  const payload = { driver: "database" as const, sessionId: "s1", userId: "u1", organizationId: "org-2", token: "t", expiresAt: "2099-01-01T00:00:00.000Z" };
  assert.equal((await getCurrentUserFromPayload(payload))?.organizationId, "org-2");
  const selection = (queries[0].select as Record<string, unknown>).user as { select: { memberships: { where: { organizationId: string } } } };
  assert.equal(selection.select.memberships.where.organizationId, "org-2");
  const readsBeforeLegacySession = queries.length;
  assert.equal(await getCurrentUserFromPayload({ ...payload, organizationId: undefined }), undefined);
  assert.equal(queries.length, readsBeforeLegacySession);
  assert.equal(await getCurrentUserFromPayload({ ...payload, organizationId: "revoked-org" }), undefined);
});

test("登录快照仍使用客户端可读 cookie，仅用于 UI", async () => {
  const deps: Record<string, unknown> = {
    "node:crypto": await import("node:crypto"),
    "next/headers": { cookies: async () => ({ get: () => undefined, delete: () => {} }) },
    react: { cache: (fn: unknown) => fn },
    "@/lib/server/performance": { measureServerOperation: async (_name: string, fn: () => unknown) => fn() },
    "@/lib/db/prisma": { prisma: { userSession: { create: async ({ data }: { data: unknown }) => ({ id: "s1", ...data as object }) } } },
    "@/lib/auth/constants": {
      getAuthDriver: () => "database",
      getAuthSecret: () => "fixture-secret-at-least-32-characters-long",
      sessionCookieName: "amazon_bulk_ad_session",
      sessionMaxAgeSeconds: 60 * 60 * 12,
    },
    "@/lib/accounts/permissions": { rolePermissionsCookieName: "amazon_bulk_ad_role_permissions" },
    "@/lib/accounts/role-permissions-server": {
      getOrganizationRolePermissionsSnapshot: async () => ({ permissions: { owner: { products: ["view"] } }, revision: "r1" }),
    },
    "@/lib/auth/request-security": { isSecureRequest: () => false },
  };
  const { createSession } = loadModule<typeof import("@/lib/auth/session")>("src/lib/auth/session.ts", deps);
  const result = await createSession("u1", {
    id: "u1",
    email: "owner@example.com",
    name: "Owner",
    role: "owner",
    organizationId: "org1",
    organizationName: "Org",
  }, true);
  const options = result.rolePermissionsCookie!.options;
  assert.equal(options.maxAge, 60 * 60 * 24);
  assert.equal(options.secure, true);
  assert.equal("httpOnly" in options, false);
});

test("占位用户记录使用随机不可知口令且只在创建时写入", async () => {
  let write: { update: Record<string, unknown>; create: Record<string, unknown> } | undefined;
  const dependencies: Record<string, unknown> = {
    "node:crypto": await import("node:crypto"),
    "@prisma/client": { OrganizationRole: { viewer: "viewer" } },
    "@/lib/db/prisma": { prisma: {
      organization: { upsert: async () => ({}) },
      user: { upsert: async (input: typeof write) => { write = input; return {}; } },
    } },
    "@/lib/auth/password": { hashPassword },
    "@/lib/accounts/member-call-account": { upsertMemberWithCallAccount: async () => ({}) },
  };
  const { ensureCurrentUserRecord } = loadModule<typeof import("@/lib/auth/ensure-user-record")>("src/lib/auth/ensure-user-record.ts", dependencies);
  await ensureCurrentUserRecord({ id: "local", email: "local@example.invalid", name: "Local", role: "viewer", organizationId: "org", organizationName: "Org" });
  assert.ok(write);
  assert.equal("passwordHash" in write.update, false);
  const candidate = "__local_session_placeholder__";
  assert.equal(verifyPassword(candidate, write.create.passwordHash as string), false);
  assert.match(write.create.passwordHash as string, /^scrypt:/);
});
