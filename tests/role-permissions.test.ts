import assert from "node:assert/strict";
import test from "node:test";
import { mergeRolePermissions } from "@/lib/accounts/role-permissions-utils";
import { defaultRolePermissionMap, roleCanPerformAction } from "@/lib/accounts/permissions";

test("显式权限快照不补齐默认角色或模块权限", () => {
  assert.equal(roleCanPerformAction("owner", "settings", "edit", {}), false);
  assert.equal(roleCanPerformAction("owner", "settings", "edit", { owner: {} }), false);
  assert.equal(roleCanPerformAction("owner", "settings", "edit", { owner: { agents: ["view"] } }), false);
  assert.equal(roleCanPerformAction("owner", "agents", "view", { owner: { agents: ["view"] } }), true);
});

test("catalog数据库故障即使已有成功快照也拒绝授权", async () => {
  const { getOrganizationRoleCatalogSnapshot } = await import("@/lib/accounts/role-catalog-server");
  const globals = globalThis as typeof globalThis & { prisma?: unknown };
  const previousDb = globals.prisma, previousUrl = process.env.DATABASE_URL;
  let unavailable = false;
  globals.prisma = { organizationRosterRole: { findMany: async () => {
    if (unavailable) throw new Error("ECONNREFUSED fixture");
    return [{ id: "owner", name: "组织管理员", description: "测试", permissions: { settings: ["edit"] }, sortOrder: 0, updatedAt: new Date(0) }];
  } } };
  process.env.DATABASE_URL = "postgresql://fixture.invalid/unused";
  try {
    const first = await getOrganizationRoleCatalogSnapshot("strict-fixture-org");
    assert.equal(roleCanPerformAction("owner", "settings", "edit", Object.fromEntries(first.roles.map(role => [role.id, role.permissions]))), true);
    unavailable = true;
    const denied = await getOrganizationRoleCatalogSnapshot("strict-fixture-org");
    assert.equal(denied.revision, "database-unavailable-minimal");
    assert.equal(roleCanPerformAction("owner", "settings", "edit", Object.fromEntries(denied.roles.map(role => [role.id, role.permissions]))), false);
  } finally {
    globals.prisma = previousDb;
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  }
});

test("owner 目录读取恢复全部权限，普通角色仍以保存权限为准且不读取旧表", async () => {
  const { getOrganizationRoleCatalogSnapshot, readOrganizationRolePermissions } = await import("@/lib/accounts/role-catalog-server");
  const globals = globalThis as typeof globalThis & { prisma?: unknown };
  const previousDb = globals.prisma, previousUrl = process.env.DATABASE_URL;
  const rows: Array<{ id: string; name: string; description: string; permissions: Record<string, string[]>; sortOrder: number; updatedAt: Date }> = [];
  let legacyReads = 0;
  const client = {
    organizationRosterRole: {
      findMany: async () => rows,
      count: async () => rows.length,
      createMany: async ({ data }: { data: Array<Omit<(typeof rows)[number], "updatedAt">> }) => { rows.push(...data.map(row => ({ ...row, updatedAt: new Date(0) }))); },
    },
    organizationRolePermission: { findUnique: async () => { legacyReads++; throw new Error("禁止读取旧权限来源"); } },
  };
  globals.prisma = { ...client, $transaction: async (operation: (tx: typeof client) => Promise<void>) => operation(client) };
  process.env.DATABASE_URL = "postgresql://fixture.invalid/unused";
  try {
    const seeded = await getOrganizationRoleCatalogSnapshot("new-catalog-fixture");
    assert.ok(seeded.roles.length > 0);
    assert.equal(legacyReads, 0);
    rows.splice(0, rows.length, { id: "owner", name: "受限管理员", description: "测试", permissions: { agents: ["view"] }, sortOrder: 0, updatedAt: new Date(1) });
    const permissions = await readOrganizationRolePermissions(client as unknown as Parameters<typeof readOrganizationRolePermissions>[0], "new-catalog-fixture");
    assert.equal(roleCanPerformAction("owner", "settings", "edit", permissions), true);
    assert.deepEqual(permissions.owner, defaultRolePermissionMap.owner);
    rows.push({ id: "viewer", name: "受限角色", description: "测试", permissions: {}, sortOrder: 1, updatedAt: new Date(2) });
    const restricted = await readOrganizationRolePermissions(client as unknown as Parameters<typeof readOrganizationRolePermissions>[0], "new-catalog-fixture");
    assert.equal(roleCanPerformAction("viewer", "agents", "view", restricted), false);
    assert.equal(roleCanPerformAction("owner", "agents", "view", permissions), true);
    assert.equal(legacyReads, 0);
  } finally {
    globals.prisma = previousDb;
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  }
});

test("default role matrix keeps view-only roles from write actions and operations out of PPC", () => {
  for (const role of ["viewer", "designer", "finance"]) {
    assert.equal(roleCanPerformAction(role, "products", "edit"), false);
    assert.equal(roleCanPerformAction(role, "products", "export"), role === "finance");
    assert.equal(roleCanPerformAction(role, "agents", "approve"), false);
  }

  assert.deepEqual(defaultRolePermissionMap.operations.workspace ?? [], []);
  assert.deepEqual(defaultRolePermissionMap.viewer, { agents: ["view"] });
});


test("保存 owner 空权限时服务端固定写入全权限，普通角色不扩权", async () => {
  const { saveOrganizationRoleCatalog } = await import("@/lib/accounts/role-catalog-server");
  const globals = globalThis as typeof globalThis & { prisma?: unknown };
  const previousDb = globals.prisma, previousUrl = process.env.DATABASE_URL;
  const saved: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: async () => [{ locked: 1 }],
    organizationRosterRole: {
      deleteMany: async () => ({ count: 0 }),
      upsert: async ({ create }: { create: Record<string, unknown> }) => { saved.push({ ...create, updatedAt: new Date(0) }); },
      findMany: async () => saved,
    },
  };
  globals.prisma = { $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) };
  process.env.DATABASE_URL = "postgresql://fixture.invalid/unused";
  try {
    const result = await saveOrganizationRoleCatalog("owner-save-fixture", [
      { id: "owner", name: "超级管理员", description: "", permissions: {}, sortOrder: 0 },
      { id: "viewer", name: "查看者", description: "", permissions: {}, sortOrder: 1 },
    ]);
    assert.deepEqual(saved[0].permissions, defaultRolePermissionMap.owner);
    assert.deepEqual(result.roles[0].permissions, defaultRolePermissionMap.owner);
    assert.deepEqual(saved[1].permissions, {});
  } finally {
    globals.prisma = previousDb;
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  }
});

test("Amazon 权限合并入口同样保持 owner 全权限", () => {
  const merged = mergeRolePermissions([{ id: "owner", permissions: { workspace: [], operations: [] } }]);
  assert.deepEqual(merged.owner, defaultRolePermissionMap.owner);
});
