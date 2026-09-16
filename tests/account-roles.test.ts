import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAccountRoleId, toOrganizationRoleId } from "@/lib/accounts/team-roster";

test("normalizes Chinese and composite account roles from roster workbooks", () => {
  assert.equal(normalizeAccountRoleId("财务"), "finance");
  assert.equal(normalizeAccountRoleId("运营"), "operations");
  assert.equal(normalizeAccountRoleId("沃尔玛运营,运营"), "operations");
  assert.equal(normalizeAccountRoleId("沃尔玛运营,运营主管/主管助理,运营"), "operations_supervisor");
  assert.equal(normalizeAccountRoleId("仓管员,业绩板"), "warehouse");
  assert.equal(normalizeAccountRoleId("选品"), "developer");
  assert.equal(normalizeAccountRoleId("乐器查看账号"), "viewer");
});

test("only canonical organization roles reach Prisma membership writes", () => {
  assert.equal(toOrganizationRoleId("finance"), "finance");
  assert.equal(toOrganizationRoleId("财务"), "finance");
  assert.equal(toOrganizationRoleId("custom-read-only-role"), "viewer");
});
