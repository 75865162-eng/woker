import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { assertWmsAccess } from "../src/lib/wms/access";
import { getAccessiblePathOrFallback } from "../src/lib/accounts/permissions";

const scope = { organizationId: "org", workspaceId: "workspace", actorUserId: "user", userId: "user", action: "view" as const };

function transaction(options: { role?: string; permissions?: unknown; member?: boolean; rosterActive?: boolean; roleExists?: boolean; workspace?: boolean; workspaceMember?: boolean } = {}) {
  const role = options.role ?? "owner";
  let call = 0;
  return {
    $queryRaw: async () => {
      call++;
      if (call === 1) return [{ id: "org" }];
      if (call === 2) return options.member === false ? [] : [{ role }];
      if (call === 3) return [{ status: options.rosterActive === false ? "inactive" : "active" }];
      return options.roleExists === false ? [] : [{ permissions: options.permissions ?? {} }];
    },
    workspaceScope: { findUnique: async () => options.workspace === false ? null : { id: "workspace" } },
    organizationMember: { findUnique: async () => options.member === false ? null : { role, user: { status: "active" } } },
    workspaceMembership: { findUnique: async () => options.workspaceMember ? { userId: "user" } : null },
  } as unknown as Prisma.TransactionClient;
}

test("WMS uses the catalog owner permissions without bypassing membership and workspace checks", async () => {
  const result = await assertWmsAccess(transaction(), scope);
  assert.deepEqual(result.permissions.wms, ["view", "create", "edit", "approve", "export"]);
  for (const options of [{ member: false }, { rosterActive: false }, { roleExists: false }, { workspace: false }]) {
    await assert.rejects(assertWmsAccess(transaction(options), scope));
  }
});

test("WMS ordinary roles still require their actual permission and workspace membership", async () => {
  await assert.rejects(assertWmsAccess(transaction({ role: "viewer", workspaceMember: true }), scope));
  await assert.rejects(assertWmsAccess(transaction({ role: "viewer", permissions: { wms: ["view"] } }), scope));
  await assert.doesNotReject(assertWmsAccess(transaction({ role: "viewer", permissions: { wms: ["view"] }, workspaceMember: true }), scope));
});

test("the forbidden page is accessible even when no module is permitted", () => {
  assert.equal(getAccessiblePathOrFallback("/forbidden", "viewer", { viewer: {} }), "/forbidden");
  assert.notEqual(getAccessiblePathOrFallback("/not-registered", "owner", { owner: {} }), "/not-registered");
});
