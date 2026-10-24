import assert from "node:assert/strict";
import test from "node:test";
import { defaultRolePermissionMap, roleCanPerformAction } from "@/lib/accounts/permissions";

test("default role matrix keeps view-only roles from write actions and operations out of PPC", () => {
  for (const role of ["viewer", "designer", "finance"]) {
    assert.equal(roleCanPerformAction(role, "products", "edit"), false);
    assert.equal(roleCanPerformAction(role, "products", "export"), role === "finance");
    assert.equal(roleCanPerformAction(role, "agents", "approve"), false);
  }

  assert.deepEqual(defaultRolePermissionMap.operations.workspace ?? [], []);
  assert.deepEqual(defaultRolePermissionMap.viewer, { agents: ["view"] });
});
