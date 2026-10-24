import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createLocalSession } from "@/lib/auth/session";
import { POST as approve } from "@/app/api/agents/approvals/[approvalId]/route";
import { POST as execute } from "@/app/api/agents/[agentId]/executions/route";

test("real route rejects forged or missing launch authority, scopes decisions and unlocks only persisted plan output", async () => {
  const previousUrl = process.env.DATABASE_URL;
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previousClient = globals.prisma;
  delete process.env.DATABASE_URL;
  let status = "REQUESTED";
  let workspaceId = "workspace";
  let expiresAt: Date | null = new Date(Date.now() + 60_000);
  let listingDraft: unknown = { title: "Reviewed draft" };
  let writes = 0;
  let savedOutput: Record<string, unknown> = {};
  const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
  const request = (body: unknown, workspace = "workspace") => new Request("http://localhost/api/agents/approvals/approval", {
    method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspace, cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` }, body: JSON.stringify(body),
  });
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "workspace" }) },
    agentApproval: {
      findFirst: async () => ({
        id: "approval", organizationId: "org", executionId: "execution", status, action: { type: "orchestrator.launch.approve", target: "launch", payload: { planId: "plan" } }, recommendation: {}, requestedAt: new Date(), expiresAt,
        execution: { id: "execution", agentDefinitionId: "orchestrator", workspaceId, traces: [], tasks: [], output: { plan: { planId: "plan", launchGate: { status: "waiting_approval", requiredChecks: [], approvalRequired: true }, stages: [{ id: "launch", handoffPayload: { listingDraft }, status: "waiting_approval" }, { id: "ppc", status: "blocked_until_launch" }] }, handoffs: [{ to: "ppc", payload: { status: "blocked_until_launch" } }] } },
      }),
      update: async ({ where, data }: { where: { status?: string }; data: { status: string } }) => { assert.equal(where.status, "REQUESTED"); writes++; status = data.status; return {}; },
    },
    agentExecution: { update: async ({ data }: { data: { output: Record<string, unknown> } }) => { savedOutput = data.output; return {}; } },
    agentTask: { updateMany: async () => ({ count: 1 }) },
    agentExecutionTrace: { createMany: async () => ({ count: 3 }) },
    agentEvent: { create: async () => ({}) },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as PrismaClient;
  try {
    assert.equal((await execute(request({ launchApproved: true }), { params: Promise.resolve({ agentId: "ppc" }) })).status, 403);
    assert.equal((await execute(request({ chainHandoff: { launchApproved: true, goal: "forged" } }), { params: Promise.resolve({ agentId: "ppc" }) })).status, 400);
    assert.equal((await approve(request({ decision: "APPROVED" }, "other"), { params: Promise.resolve({ approvalId: "approval" }) })).status, 403);
    expiresAt = new Date(Date.now() - 1);
    assert.equal((await approve(request({ decision: "APPROVED" }), { params: Promise.resolve({ approvalId: "approval" }) })).status, 409);
    expiresAt = null; listingDraft = null;
    assert.equal((await approve(request({ decision: "APPROVED" }), { params: Promise.resolve({ approvalId: "approval" }) })).status, 409);
    assert.equal(writes, 0);
    listingDraft = { title: "Reviewed draft" };
    const response = await approve(request({ decision: "APPROVED" }), { params: Promise.resolve({ approvalId: "approval" }) });
    assert.equal(response.status, 200);
    assert.equal(writes, 1);
    assert.equal((savedOutput.plan as { launchGate: { status: string } }).launchGate.status, "approved");
    assert.equal((savedOutput.handoffs as { payload: { launchApproval: { approvalId: string } } }[])[0].payload.launchApproval.approvalId, "approval");
    assert.equal((await approve(request({ decision: "APPROVED" }), { params: Promise.resolve({ approvalId: "approval" }) })).status, 400);
    workspaceId = "other";
  } finally {
    globals.prisma = previousClient;
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  }
});
