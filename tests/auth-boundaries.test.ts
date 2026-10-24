import assert from "node:assert/strict";
import test from "node:test";
import { rolePermissionsCookieName } from "@/lib/accounts/permissions";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { authorizeOps, parseOpsArgs, type OpsIdentity } from "@/lib/operations/cli";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import type { Prisma } from "@prisma/client";

test("workspace identifiers are checked against the organization before scoped reads", async () => {
  const identity: OpsIdentity = { organizationId: "org-a", workspaceId: "workspace-b", actorUserId: "user-a" };
  const db = {
    organizationMember: { findFirst: async () => ({ role: "staff" }) },
    workspaceScope: { findUnique: async ({ where }: { where: { organizationId_id: { organizationId: string; id: string } } }) =>
      where.organizationId_id.organizationId === "org-a" && where.organizationId_id.id === "workspace-b" ? null : { id: "workspace-a" } },
    organizationRosterRole: { findMany: async () => [{ id: "staff", permissions: { operations: ["view"] } }] },
  } as unknown as Prisma.TransactionClient;

  await assert.rejects(() => authorizeOps(db, identity, parseOpsArgs(["freshness"])), /workspace/);
});

test("workspace access query is tenant-bound", async () => {
  const lookups: unknown[] = [];
  const client = {
    workspaceScope: {
      findUnique: async (args: unknown) => { lookups.push(args); return null; },
    },
  } as never;

  assert.equal(await assertWorkspaceAccess("org-a", "forged-workspace", client), false);
  assert.deepEqual(lookups, [{
    where: { organizationId_id: { organizationId: "org-a", id: "forged-workspace" } },
    select: { id: true },
  }]);
});

test("operations view permission is required independently of workspace membership", async () => {
  const identity: OpsIdentity = { organizationId: "org-a", workspaceId: "workspace-a", actorUserId: "user-a" };
  const db = {
    organizationMember: { findFirst: async () => ({ role: "staff" }) },
    workspaceScope: { findUnique: async () => ({ id: "workspace-a" }) },
    organizationRosterRole: { findMany: async () => [{ id: "staff", permissions: { workspace: ["view"] } }] },
  } as unknown as Prisma.TransactionClient;

  await assert.rejects(() => authorizeOps(db, identity, parseOpsArgs(["freshness"])), /Missing module view permission/);
});

test("forged permission and session cookies cannot create a database-backed identity", async () => {
  const request = new Request("https://example.test/api/operations/freshness", {
    headers: {
      cookie: `${rolePermissionsCookieName}=%7B%22owner%22%3A%7B%22operations%22%3A%5B%22view%22%5D%7D%7D; amazon_bulk_ad_session=eyJkcml2ZXIiOiJkYXRhYmFzZSJ9.forged`,
    },
  });

  assert.equal(await getCurrentUserFromRequest(request), undefined);
});
