import assert from "node:assert/strict";
import test from "node:test";
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

test("新组织角色目录初始化不读取旧权限表，已收紧的目录不合并默认权限", async () => {
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
    assert.equal(roleCanPerformAction("owner", "settings", "edit", permissions), false);
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
