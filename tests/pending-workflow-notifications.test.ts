import assert from "node:assert/strict";
import test from "node:test";
import { selectPendingWorkflowNotifications, type WorkflowNotificationCandidate } from "@/lib/notifications/pending-workflow-notifications";
import { createLocalSession, getNotificationSessionKey } from "@/lib/auth/session";

function candidate(overrides: Partial<WorkflowNotificationCandidate> = {}): WorkflowNotificationCandidate {
  const due = "2026-10-29T08:00:00.000Z";
  return {
    id: "notification", organizationId: "org", recipientUserId: "user", actorUserId: null,
    dedupeKey: null, type: "product_workflow", title: "任务", message: "请处理", entityType: "product", entityId: "SKU",
    metadata: { productId: "p", workspaceId: "w", stage: "ops_confirming", dueAt: due },
    readAt: new Date(), createdAt: new Date(), currentProductId: "p", currentSku: "SKU", currentWorkspaceId: "w",
    currentStatus: "ops_review", currentStage: "ops_confirming", currentDueAt: new Date(due),
    currentOpsAssignee: "小王", currentOpsAssignees: [], currentDesignerAssignee: "小李", currentDesignerAssignees: [],
    recipientName: "小王", ...overrides,
  };
}

test("pending tasks include read notifications and collapse assignment/overdue duplicates", () => {
  const result = selectPendingWorkflowNotifications([
    candidate({ id: "overdue", type: "product_workflow_overdue" }), candidate({ id: "assignment", readAt: null }),
  ]);
  assert.deepEqual(result.map((item) => item.id), ["overdue"]);
  assert.ok(result[0].readAt);
  assert.equal("currentProductId" in result[0], false);
});

test("completed, advanced, reassigned and foreign workspace tasks are excluded", () => {
  for (const change of [
    { currentStatus: "listed" }, { currentStatus: "canceled" }, { currentStatus: "design_in_progress" },
    { currentOpsAssignee: "别人" },
    { currentProductId: "other" }, { currentWorkspaceId: "other" }, { metadata: null },
  ] satisfies Partial<WorkflowNotificationCandidate>[]) {
    assert.equal(selectPendingWorkflowNotifications([candidate(change)]).length, 0, JSON.stringify(change));
  }
});

test("design review and multiple assignees use current responsibility", () => {
  const row = candidate({ currentStatus: "listing_confirming", currentStage: "design_review",
    currentDesignerAssignee: "主美工", currentDesignerAssignees: ["小王"],
    metadata: { productId: "p", workspaceId: "w", stage: "design_review", dueAt: "2026-10-29T08:00:00.000Z" },
  });
  assert.equal(selectPendingWorkflowNotifications([row]).length, 1);
  assert.equal(selectPendingWorkflowNotifications([{ ...row, currentDesignerAssignees: [] }]).length, 0);
});

test("display scope persists within a login and changes for a new login without exposing cookies", async () => {
  const user = { id: "user", email: "u@test.local", name: "User", role: "owner", organizationId: "org", organizationName: "Org" };
  const first = await createLocalSession(user);
  const second = await createLocalSession(user);
  const request = (value: string) => new Request("http://localhost", { headers: { cookie: `${first.sessionCookie.name}=${value}` } });
  const key = getNotificationSessionKey(request(first.sessionCookie.value));
  assert.ok(key);
  assert.equal(getNotificationSessionKey(request(first.sessionCookie.value)), key);
  assert.notEqual(getNotificationSessionKey(request(second.sessionCookie.value)), key);
  assert.equal(getNotificationSessionKey(request("invalid")), null);
  assert.ok(!first.sessionCookie.value.includes(key));
});

test("notification API scopes pending work to the authenticated recipient and checks product permissions", async () => {
  const { GET } = await import("@/app/api/notifications/user/route");
  const globals = globalThis as unknown as { prisma?: import("@prisma/client").PrismaClient };
  const previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  process.env.DATABASE_URL = "mock-only"; process.env.AUTH_DRIVER = "local";
  let canView = true; let queryCalls = 0;
  globals.prisma = {
    userNotification: {
      findMany: async ({ where, take }: { where: unknown; take: number }) => {
        assert.deepEqual(where, { organizationId: "org", recipientUserId: "user" });
        assert.equal(take, 1); return [];
      },
      count: async () => 0,
    },
    organizationRosterRole: { findMany: async () => [{ id: "owner", name: "Owner", description: "", sortOrder: 0,
      updatedAt: new Date(), permissions: { products: canView ? ["view"] : [] } }] },
    $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      queryCalls++;
      assert.deepEqual(values, ["org", "user"]);
      const sql = parts.join("?");
      assert.match(sql, /p\."organizationId" = n\."organizationId"/);
      assert.match(sql, /p\."workspaceId" = n\.metadata->>'workspaceId'/);
      assert.doesNotMatch(sql, /readAt.*IS NULL|LIMIT/i);
      return [candidate()];
    },
  } as unknown as import("@prisma/client").PrismaClient;
  try {
    const { sessionCookie } = await createLocalSession({ id: "user", email: "u@test.local", name: "User", role: "owner", organizationId: "org", organizationName: "Org" });
    const request = () => new Request("http://localhost/api/notifications/user?limit=1", { headers: { cookie: `${sessionCookie.name}=${sessionCookie.value}` } });
    const response = await GET(request());
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.notifications.length, 0);
    assert.equal(data.pendingWorkflowNotifications.length, 1, "older tasks are independent of history page and read state");
    assert.equal(data.notificationSessionKey, getNotificationSessionKey(request()));
    canView = false;
    const denied = await (await GET(request())).json();
    assert.deepEqual(denied.pendingWorkflowNotifications, []);
    assert.equal(queryCalls, 1);
    assert.equal((await GET(new Request("http://localhost/api/notifications/user"))).status, 401);
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});


test("rescheduling pending work refreshes its deadline and SKU instead of hiding the task", () => {
  const [result] = selectPendingWorkflowNotifications([candidate({ type: "product_workflow_overdue", currentDueAt: new Date("2100-11-01T00:00:00Z"), currentSku: "NEW-SKU" })]);
  assert.equal((result.metadata as Record<string, unknown>).dueAt, "2100-11-01T00:00:00.000Z");
  assert.equal(result.type, "product_workflow");
  assert.doesNotMatch(result.title, /超期/);
  assert.equal((result.metadata as Record<string, unknown>).sku, "NEW-SKU");
  assert.match(result.message, /NEW-SKU/);
  assert.equal(selectPendingWorkflowNotifications([candidate({ currentDueAt: null })]).length, 1);
});
