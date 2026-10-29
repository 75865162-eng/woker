import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUserFromRequest, getNotificationSessionKey } from "@/lib/auth/session";
import { isDatabaseUnavailableError } from "@/lib/db/is-database-unavailable-error";
import { prisma } from "@/lib/db/prisma";
import { loadPendingWorkflowNotifications } from "@/lib/notifications/pending-workflow-notifications";
import { roleCanAccessModule } from "@/lib/accounts/permissions";
import { getOrganizationRolePermissionsSnapshot } from "@/lib/accounts/role-permissions-server";

export const runtime = "nodejs";

function clampLimit(value: string | null) {
  const limit = Number(value) || 30;
  return Math.min(Math.max(limit, 1), 100);
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUserFromRequest(request);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ notifications: [], unreadCount: 0 });
    }

    const url = new URL(request.url);
    const limit = clampLimit(url.searchParams.get("limit"));

    const where: Prisma.UserNotificationWhereInput = {
      organizationId: user.organizationId,
      recipientUserId: user.id,
    };

    try {
      const [notifications, unreadCount, pendingWorkflowNotifications] = await Promise.all([
        prisma.userNotification.findMany({
          where,
          orderBy: {
            createdAt: "desc",
          },
          take: limit,
        }),
        prisma.userNotification.count({
          where: {
            ...where,
            readAt: null,
          },
        }),
        (async () => {
          const snapshot = await getOrganizationRolePermissionsSnapshot(user.organizationId);
          return roleCanAccessModule(user.role, "products", snapshot.permissions)
            ? loadPendingWorkflowNotifications(user.organizationId, user.id)
            : [];
        })(),
      ]);

      return NextResponse.json({ notifications, unreadCount, pendingWorkflowNotifications, notificationSessionKey: getNotificationSessionKey(request) });
    } catch (error) {
      if (isDatabaseUnavailableError(error)) {
        return NextResponse.json({ notifications: [], unreadCount: 0, error: "数据库暂时不可用，站内通知已切换为空数据。" }, { status: 503 });
      }

      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "通知读取失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUserFromRequest(request);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ ok: true });
    }

    const body = (await request.json().catch(() => ({}))) as { ids?: unknown; all?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id)).filter(Boolean) : [];
    const now = new Date();

    await prisma.userNotification.updateMany({
      where: {
        organizationId: user.organizationId,
        recipientUserId: user.id,
        readAt: null,
        ...(body.all ? {} : { id: { in: ids } }),
      },
      data: {
        readAt: now,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "通知状态更新失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
