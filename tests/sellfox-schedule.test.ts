import test from "node:test";
import assert from "node:assert/strict";
import { isSellfoxScheduleDue, nextSellfoxScheduleAt, sellfoxSyncScopeLock } from "@/lib/sellfox/schedule-time";
import { canExecuteSellfoxSync } from "@/lib/sellfox/sync-authorization";
import { defaultRolePermissionMap } from "@/lib/accounts/permissions";

test("daily schedules wait for Shanghai 06:30, catch up once, and cross UTC midnight correctly", () => {
  const schedule = { resource: "sales", intervalMinutes: 1440, lastEnqueuedAt: null };
  const before = new Date("2026-10-24T22:29:59Z");
  assert.equal(isSellfoxScheduleDue(schedule, before), false);
  assert.equal(nextSellfoxScheduleAt(schedule, before).toISOString(), "2026-10-24T22:30:00.000Z");
  assert.equal(isSellfoxScheduleDue(schedule, new Date("2026-10-24T22:30:00Z")), true);
  const completed = { ...schedule, lastEnqueuedAt: new Date("2026-10-24T22:31:00Z") };
  assert.equal(isSellfoxScheduleDue(completed, new Date("2026-10-25T10:00:00Z")), false);
  assert.equal(nextSellfoxScheduleAt(completed, new Date("2026-10-25T10:00:00Z")).toISOString(), "2026-10-25T22:30:00.000Z");
  assert.equal(isSellfoxScheduleDue(completed, new Date("2026-10-26T01:00:00Z")), true);
});

test("inventory interval is measured from enqueue and scope lock has no separator collisions", () => {
  const schedule = { resource: "inventory", intervalMinutes: 180, lastEnqueuedAt: new Date("2026-10-25T00:00:00Z") };
  assert.equal(isSellfoxScheduleDue(schedule, new Date("2026-10-25T02:59:59Z")), false);
  assert.equal(isSellfoxScheduleDue(schedule, new Date("2026-10-25T03:00:00Z")), true);
  assert.notEqual(sellfoxSyncScopeLock("a-b", "c", "sales"), sellfoxSyncScopeLock("a", "b-c", "sales"));
  assert.notEqual(sellfoxSyncScopeLock("a", "b", "sales"), sellfoxSyncScopeLock("a", "b", "inventory"));
});

test("execution rechecks active membership, current create permission and workspace", async () => {
  const scope = { organizationId: "org", workspaceId: "workspace", userId: "user" };
  const deps = { member: async () => ({ role: "owner" as const, user: { status: "active" as const } }), permissions: async () => defaultRolePermissionMap, workspace: async () => true };
  assert.equal(await canExecuteSellfoxSync(scope, deps), true);
  assert.equal(await canExecuteSellfoxSync(scope, { ...deps, member: async () => null }), false);
  assert.equal(await canExecuteSellfoxSync(scope, { ...deps, member: async () => ({ role: "owner", user: { status: "disabled" } }) }), false);
  assert.equal(await canExecuteSellfoxSync(scope, { ...deps, workspace: async () => false }), false);
  assert.equal(await canExecuteSellfoxSync(scope, { ...deps, member: async () => ({ role: "viewer", user: { status: "active" } }) }), false);
});
