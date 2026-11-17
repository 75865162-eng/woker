import assert from "node:assert/strict";
import test from "node:test";
import { roleCanPerformAction, defaultRolePermissionMap } from "@/lib/accounts/permissions";
import { mergeRolePermissions } from "@/lib/accounts/role-permissions-utils";
import {
  getOrganizationRolePermissionsCached,
  invalidateOrganizationRolePermissions,
  setRolePermissionCacheRedisForTest,
} from "@/lib/accounts/role-permission-cache";

// Disable Redis for these tests so only the in-process LRU is under test.
setRolePermissionCacheRedisForTest(null);

test("mergeRolePermissions keeps defaults and overlays stored role permissions", () => {
  const merged = mergeRolePermissions([
    { id: "viewer", permissions: { sellfox: ["view"] } },
    { id: "custom", permissions: { operations: ["view", "create"] } },
  ]);
  // Stored modules overlay defaults while untouched default modules survive.
  assert.equal(merged.viewer?.sellfox?.[0], "view");
  assert.deepEqual(merged.viewer?.agents, (defaultRolePermissionMap as Record<string, Record<string, string[]>>).viewer?.agents);
  assert.deepEqual(merged.custom, { operations: ["view", "create"] });
  assert.deepEqual(merged.owner, (defaultRolePermissionMap as Record<string, unknown>).owner);
  // Invalid actions are filtered through normalizeRolePermissions.
  const badActions = (mergeRolePermissions([{ id: "bad", permissions: { sellfox: ["view", "drop-table"] } }]).bad?.sellfox ?? []) as string[];
  assert.equal(badActions.includes("drop-table"), false);
});

test("cache hit avoids re-reading the source within TTL", async () => {
  const org = "org-cache-hit";
  invalidateOrganizationRolePermissions(org);
  let reads = 0;
  const source = async () => { reads += 1; return mergeRolePermissions([{ id: "viewer", permissions: { sellfox: ["view"] } }]); };
  const first = await getOrganizationRolePermissionsCached(org, source);
  const second = await getOrganizationRolePermissionsCached(org, source);
  assert.equal(reads, 1, "second read must hit cache");
  assert.deepEqual(second, first);
});

test("invalidate forces the next read back to source", async () => {
  const org = "org-cache-invalidate";
  invalidateOrganizationRolePermissions(org);
  let reads = 0;
  const source = async () => { reads += 1; return mergeRolePermissions([{ id: "viewer", permissions: { sellfox: ["view"] } }]); };
  await getOrganizationRolePermissionsCached(org, source);
  await getOrganizationRolePermissionsCached(org, source);
  assert.equal(reads, 1);
  invalidateOrganizationRolePermissions(org);
  await getOrganizationRolePermissionsCached(org, source);
  assert.equal(reads, 2, "invalidate must force a re-read");
});

test("failed source is not cached", async () => {
  const org = "org-cache-fail";
  invalidateOrganizationRolePermissions(org);
  let calls = 0;
  const failing = async () => { calls += 1; throw new Error("db down"); };
  await assert.rejects(() => getOrganizationRolePermissionsCached(org, failing), /db down/);
  await assert.rejects(() => getOrganizationRolePermissionsCached(org, failing), /db down/);
  assert.equal(calls, 2, "a failed source must not be cached");
});

test("cached map still drives the same authorization verdict", async () => {
  const org = "org-cache-verdict";
  invalidateOrganizationRolePermissions(org);
  const map = await getOrganizationRolePermissionsCached(org, async () =>
    mergeRolePermissions([{ id: "viewer", permissions: { sellfox: ["view"] } }]));
  assert.equal(roleCanPerformAction("viewer", "sellfox", "view", map), true);
  assert.equal(roleCanPerformAction("viewer", "sellfox", "edit", map), false);
});
