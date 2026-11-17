import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

type AuditLogWriter = Pick<typeof prisma, "auditLog">;

export type AccessDeniedReason = "role_action_denied" | "workspace_access_denied";

/**
 * 记录越权尝试。审计写入是 best-effort：
 * 审计失败不能改变拒绝结果，也不能把 403 变成 500。
 * client 可注入，便于在不连接真实数据库的场景下验证写入内容。
 */
export async function recordAccessDenied(
  input: {
    organizationId?: string;
    userId?: string;
    reason: AccessDeniedReason;
    moduleId: string;
    action: string;
    path?: string;
    requestedWorkspaceId?: string | null;
  },
  client: AuditLogWriter = prisma,
): Promise<boolean> {
  const metadata: Record<string, unknown> = {
    reason: input.reason,
    moduleId: input.moduleId,
    action: input.action,
  };
  if (input.path) metadata.path = input.path;
  if (input.requestedWorkspaceId) metadata.requestedWorkspaceId = input.requestedWorkspaceId;

  try {
    await client.auditLog.create({
      data: {
        organizationId: input.organizationId || null,
        userId: input.userId || null,
        action: "auth.access_denied",
        entityType: "AccessAttempt",
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
    return true;
  } catch {
    // Fail-soft：审计不可用时仍保持原有拒绝语义。
    return false;
  }
}
