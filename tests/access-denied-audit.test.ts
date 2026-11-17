import assert from "node:assert/strict";
import test from "node:test";
import { recordAccessDenied } from "@/lib/audit/access-denied";
import type { Prisma } from "@prisma/client";

type AuditWrite = Prisma.AuditLogUncheckedCreateInput;

test("越权尝试写入结构化审计记录，携带身份与拒绝原因", async () => {
  const created: AuditWrite[] = [];
  const client = {
    auditLog: {
      create: async ({ data }: { data: AuditWrite }) => {
        created.push(data);
        return data;
      },
    },
  } as unknown as Parameters<typeof recordAccessDenied>[1];

  const ok = await recordAccessDenied(
    {
      organizationId: "org-a",
      userId: "user-a",
      reason: "workspace_access_denied",
      moduleId: "sellfox",
      action: "view",
      path: "/api/sellfox/performance",
      requestedWorkspaceId: "forged-ws",
    },
    client,
  );

  assert.equal(ok, true);
  assert.equal(created.length, 1);
  assert.equal(created[0].action, "auth.access_denied");
  assert.equal(created[0].entityType, "AccessAttempt");
  assert.equal(created[0].organizationId, "org-a");
  assert.equal(created[0].userId, "user-a");
  const metadata = created[0].metadata as Record<string, unknown>;
  assert.equal(metadata.reason, "workspace_access_denied");
  assert.equal(metadata.moduleId, "sellfox");
  assert.equal(metadata.path, "/api/sellfox/performance");
  assert.equal(metadata.requestedWorkspaceId, "forged-ws");
});

test("审计写入失败时 fail-soft，不影响调用方（返回 false 而非抛错）", async () => {
  const client = {
    auditLog: {
      create: async () => {
        throw new Error("db unavailable");
      },
    },
  } as unknown as Parameters<typeof recordAccessDenied>[1];

  const ok = await recordAccessDenied(
    { reason: "role_action_denied", moduleId: "operations", action: "view" },
    client,
  );
  assert.equal(ok, false);
});
