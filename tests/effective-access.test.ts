import assert from "node:assert/strict";
import test from "node:test";
import type { AccessDbClient } from "@/lib/accounts/effective-access";
import { getEffectiveAccess, effectiveModuleActions } from "@/lib/accounts/effective-access";

/**
 * 隔离单测：用内存 fake client 覆盖并集语义，不连接真实数据库。
 * 只实现 getEffectiveAccess 调用到的 delegate 方法。
 */
function fakeDb(options: {
  role?: string;
  grants?: Array<Record<string, unknown>>;
  rolePermissions?: Record<string, unknown>;
  memberAmazon?: Array<Record<string, unknown>>;
  roleAmazon?: Array<Record<string, unknown>>;
  sellfoxStoreIds?: string[];
}): AccessDbClient {
  const role = options.role ?? "operations";
  const grants = options.grants ?? [];
  const db = {
    organizationMember: {
      findUnique: async () => ({ role, user: { status: "active" } }),
    },
    resourceGrant: {
      findMany: async ({ where }: { where?: { OR?: Array<{ subjectType: string; subjectId: string }> } } = {}) => {
        const wanted = new Set((where?.OR ?? []).map((w) => `${w.subjectType}:${w.subjectId}`));
        return grants.filter((g) => wanted.has(`${g.subjectType}:${g.subjectId}`));
      },
    },
    organizationRosterRole: {
      findMany: async () => (options.rolePermissions ? [{ id: role, permissions: options.rolePermissions }] : []),
    },
    amazonDataAccessGrant: { findMany: async () => options.memberAmazon ?? [] },
    amazonRoleDataAccessGrant: { findMany: async () => options.roleAmazon ?? [] },
    sellfoxMcpCredential: { findFirst: async () => (options.sellfoxStoreIds ? { storeIds: options.sellfoxStoreIds } : null) },
  };
  return db as unknown as AccessDbClient;
}

const base = { organizationId: "org1", workspaceId: "ws1", userId: "u1" };

test("并集：角色给的模块动作与成员补充动作合并", async () => {
  const db = fakeDb({
    role: "operations",
    grants: [
      { subjectType: "ROLE", subjectId: "operations", resourceType: "MODULE", resourceId: "operations", actions: ["view", "create", "edit"], scopeJson: null, source: "MANUAL" },
      { subjectType: "MEMBER", subjectId: "u1", resourceType: "MODULE", resourceId: "operations", actions: ["export"], scopeJson: null, source: "MANUAL" },
    ],
  });
  const access = await getEffectiveAccess({ ...base, roleId: "operations", db });
  assert.deepEqual(effectiveModuleActions(access, "operations"), ["view", "create", "edit", "export"]);
  assert.equal(access.sources["MODULE:operations"], "BOTH");
  assert.equal(access.isAdmin, false);
});

test("来源标注：仅角色授权时来源为 ROLE", async () => {
  const db = fakeDb({
    role: "operations",
    grants: [
      { subjectType: "ROLE", subjectId: "operations", resourceType: "MODULE", resourceId: "products", actions: ["view"], scopeJson: null, source: "MANUAL" },
    ],
  });
  const access = await getEffectiveAccess({ ...base, roleId: "operations", db });
  assert.equal(access.sources["MODULE:products"], "ROLE");
  assert.deepEqual(access.modules["products"], ["view"]);
});

test("Amazon 数据范围：角色店铺与成员店铺取并集，站点合并", async () => {
  const db = fakeDb({
    role: "operations",
    grants: [
      { subjectType: "ROLE", subjectId: "operations", resourceType: "AMAZON_SELLER", resourceId: "S1", actions: ["view", "export"], scopeJson: { marketplaceIds: ["US"] }, source: "MANUAL" },
      { subjectType: "MEMBER", subjectId: "u1", resourceType: "AMAZON_SELLER", resourceId: "S2", actions: ["view"], scopeJson: { marketplaceIds: ["DE"] }, source: "MANUAL" },
    ],
  });
  const access = await getEffectiveAccess({ ...base, roleId: "operations", db });
  const ids = access.amazon.sellers.map((s) => s.sellerAccountId).sort();
  assert.deepEqual(ids, ["S1", "S2"]);
  assert.equal(access.amazon.allSellers, false);
});

test("管理员旁路：isAdmin 为真且不伪造具体店铺", async () => {
  const db = fakeDb({ role: "owner" });
  const access = await getEffectiveAccess({ ...base, roleId: "owner", db });
  assert.equal(access.isAdmin, true);
  assert.equal(access.amazon.allSellers, true);
  assert.deepEqual(effectiveModuleActions(access, "anything"), ["view", "create", "edit", "approve", "export"]);
});

test("旧表兜底：角色权限 JSON 在无 ResourceGrant 时仍生效", async () => {
  const db = fakeDb({ role: "operations", rolePermissions: { operations: ["view", "create"] } });
  const access = await getEffectiveAccess({ ...base, roleId: "operations", db });
  assert.deepEqual(access.modules["operations"], ["view", "create"]);
  assert.equal(access.sources["MODULE:operations"], "MIGRATED");
});

test("金额以字符串表达，缺失保留 null", async () => {
  const db = fakeDb({
    role: "operations",
    grants: [
      { subjectType: "ROLE", subjectId: "operations", resourceType: "APPROVAL", resourceId: "purchase_payment", actions: ["approve"], scopeJson: { amountMin: "0", amountMax: "5000" }, source: "MANUAL" },
      { subjectType: "MEMBER", subjectId: "u1", resourceType: "POINTS", resourceId: "operations", actions: [], scopeJson: { quota: 300, maxRequestAmount: "200" }, source: "MANUAL" },
    ],
  });
  const access = await getEffectiveAccess({ ...base, roleId: "operations", db });
  assert.equal(access.approvals[0]?.min, "0");
  assert.equal(access.approvals[0]?.max, "5000");
  assert.equal(access.points.quota, "300");
  assert.equal(access.points.maxRequestAmount, "200");
  assert.equal(access.points.maxRequestsPerPeriod, null);
});

test("金额分级：审批区间边界 0–5000/5000–50000/>50000 正确匹配", async () => {
  const { matchApprovalTier } = await import("@/lib/accounts/effective-access");
  const approvals = [
    { type: "purchase_payment", min: "0", max: "5000", actions: ["approve"] },
    { type: "purchase_payment", min: "5000", max: "50000", actions: ["approve"] },
    { type: "purchase_payment", min: "50000", max: null, actions: ["approve"] },
  ];
  assert.deepEqual(matchApprovalTier(approvals, "purchase_payment", "4999.99")[0]?.max, "5000");
  assert.deepEqual(matchApprovalTier(approvals, "purchase_payment", "5000")[0]?.max, "50000");
  assert.deepEqual(matchApprovalTier(approvals, "purchase_payment", "50000")[0]?.max, null);
  assert.equal(matchApprovalTier(approvals, "purchase_payment", "100000")[0]?.max, null);
  assert.equal(matchApprovalTier(approvals, "refund", "100").length, 0);
});
