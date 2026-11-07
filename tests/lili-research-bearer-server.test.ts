import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { researchBearerDependencies } from "@/lib/lili/research-bearer-server";
import { manageMcpCredential } from "@/lib/amazon-sync/mcp";
import { researchAccess } from "@/lib/selection-research/server";
import { withResearchRequestAuthorization } from "@/lib/selection-research/request-authorization";
import { NextResponse } from "next/server";
import { handleLiliRequest } from "@/lib/lili/api";
import { handleResearchBearerMcp } from "@/lib/lili/research-bearer-mcp";

test("production permission resolver, credential grants and saved-run boundary use isolated Prisma only", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  const previousUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const scope = { organizationId: "fixture-org", workspaceId: "fixture-workspace" };
  const identity = { ...scope, id: "fixture-credential", revision: 1, userId: "fixture-user", tools: ["research_read"] };
  let role = "owner", active = true, workspace = true;
  let rolesUnavailable = false;
  let created = 0;
  let savedCredential = "other-credential";
  const member = () => ({ role, organization: { name: "Fixture" }, user: { id: identity.userId, name: "Fixture", email: "fixture@example.test", status: active ? "active" : "disabled" } });
  const db = {
    organizationMember: { findUnique: async () => member() },
    workspaceScope: { findUnique: async () => workspace ? { id: scope.workspaceId } : null },
    organizationRosterRole: { findMany: async () => { if (rolesUnavailable) throw new Error("fixture-role-store-unavailable"); return []; } },
    amazonDataAccessGrant: { findMany: async () => [{ sellerAccountId: "fixture-seller", marketplaceIds: ["fixture-site"], actions: ["view"] }] },
    amazonRoleDataAccessGrant: { findMany: async () => [] },
    amazonSellerIdentity: { findMany: async () => [{ sellerAccountId: "fixture-seller", marketplaceId: "fixture-site" }] },
    amazonSyncDataSource: { findMany: async () => [{ sellerAccountId: "fixture-seller", marketplaceId: "fixture-site" }] },
    amazonMcpCredential: { create: async ({ data }: { data: object }) => { created++; return { ...data, revision: 1 }; } },
    auditLog: { create: async () => ({}) },
    agentExecution: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      assert.equal(where.organizationId, scope.organizationId); assert.equal(where.workspaceId, scope.workspaceId); assert.equal(where.requestedByUserId, identity.userId);
      return { output: { version: 1, id: "fixture-run", scope: { ...scope, ownerId: identity.userId }, mode: "live", erpCredentialId: savedCredential }, context: {} };
    } },
  };
  globals.prisma = { ...db, $transaction: async (execute: (tx: typeof db) => Promise<unknown>) => execute(db) } as unknown as PrismaClient;
  const request = (suffix = "", extra: Record<string, string> = {}) => new Request(`http://fixture.invalid/api/lili/mcp${suffix}`, { headers: extra });
  const command = (tools: string[]) => ({ action: "create", name: "fixture grant", tools, scopes: [{ sellerAccountId: "fixture-seller", marketplaceIds: ["fixture-site"] }], expiresAt: new Date(Date.now() + 60_000).toISOString() });
  try {
    assert.equal((await researchBearerDependencies.permission(identity, "agents", "view", request())).ok, true);
    for (const req of [request("?workspaceId=other"), request("", { "x-workspace-id": "other" })]) assert.equal((await researchBearerDependencies.permission(identity, "agents", "view", req)).ok, false);
    active = false;
    assert.equal((await researchBearerDependencies.permission(identity, "agents", "view", request())).ok, false);
    active = true; workspace = false;
    assert.equal((await researchBearerDependencies.permission(identity, "agents", "view", request())).ok, false);
    workspace = true; role = "fixture-denied";
    assert.equal((await researchBearerDependencies.permission(identity, "agents", "view", request())).ok, false);
    await assert.rejects(manageMcpCredential(scope, identity.userId, command(["research_start"])), /数据范围不可访问/);
    assert.equal(created, 0);
    role = "owner";
    const research = await manageMcpCredential(scope, identity.userId, command(["data_query", "research_read", "research_step"]));
    assert.deepEqual(research.credential.tools, ["data_query", "research_read", "research_step"]);
    const legacy = await manageMcpCredential(scope, identity.userId, command(["data_query"]));
    assert.deepEqual(legacy.credential.tools, ["data_query"], "legacy credentials must not be expanded");
    await assert.rejects(manageMcpCredential(scope, identity.userId, command(["research_approve"])), /工具范围无效/);
    assert.equal(created, 2);
    let sessionFallback = false;
    const invalidBearer = new Request("http://fixture.invalid/api/lili/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer invalid", cookie: "fixture-cookie" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    assert.equal((await handleLiliRequest(invalidBearer, ["mcp"], async () => { sessionFallback = true; return userFallback(); })).status, 401);
    assert.equal(sessionFallback, false, "an invalid bearer must not fall back to an otherwise permitted session");

    const user = (await researchBearerDependencies.permission(identity, "agents", "view", request()));
    assert.ok(user.ok);
    rolesUnavailable = true;
    const outage = await handleResearchBearerMcp(new Request("http://fixture.invalid/api/lili/mcp", { method: "POST" }), { jsonrpc: "2.0", id: 1, method: "tools/list" }, { ...researchBearerDependencies, authenticate: async () => identity });
    assert.equal(outage.status, 503, "role DB errors must never fall back to owner defaults");
    assert.ok(!(await outage.text()).includes("fixture-role-store-unavailable"));
    rolesUnavailable = false;
    const child = new Request(`http://fixture.invalid/api/selection-research/fixture-run?workspaceId=${scope.workspaceId}`);
    const verified = { credentialId: identity.id, authorize: async () => user };
    // Repository reads remain organization/workspace/owner scoped in researchAccess.
    const denied = await withResearchRequestAuthorization(child, verified, () => researchAccess(child, "view", { runId: "fixture-run" }));
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.response.status, 404);
    savedCredential = identity.id;
    const permitted = await withResearchRequestAuthorization(child, verified, () => researchAccess(child, "view", { runId: "fixture-run" }));
    assert.equal(permitted.ok, true);
    const after = await researchAccess(child, "view", { runId: "fixture-run" });
    assert.equal(after.ok, false);
    if (!after.ok) assert.equal(after.response.status, 401);
    const deniedPermission = { credentialId: identity.id, authorize: async () => ({ ok: false as const, response: NextResponse.json({}, { status: 403 }) }) };
    const deniedAgain = await withResearchRequestAuthorization(child, deniedPermission, () => researchAccess(child, "view", { runId: "fixture-run" }));
    assert.equal(deniedAgain.ok, false);
  } finally {
    globals.prisma = previous;
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  }
});

function userFallback() { return { ok: true as const }; }
