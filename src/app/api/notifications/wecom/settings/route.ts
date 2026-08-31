import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { ensureCurrentUserRecord } from "@/lib/auth/ensure-user-record";
import { prisma } from "@/lib/db/prisma";
import {
  defaultWeComNotificationSettings,
  normalizeWeComNotificationSentRecords,
  normalizeWeComNotificationSettings,
  type WeComNotificationSettings,
} from "@/lib/notifications/wecom";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

type WeComSettingsPayload = {
  settings?: unknown;
  sentRecords?: unknown;
  workspaceId?: unknown;
  accountId?: unknown;
  marketplace?: unknown;
};

function parseSettings(value: unknown): WeComNotificationSettings {
  if (value == null) return defaultWeComNotificationSettings;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid WeCom notification settings payload.");
  }

  return normalizeWeComNotificationSettings(value as Partial<WeComNotificationSettings>);
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("settings", "view", request);
    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;
    const scope = workspaceScopeFromRequest(request);

    const record = await prisma.weComNotificationSetting.findUnique({
      where: {
        organizationId_workspaceId_userId: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          userId: user.id,
        },
      },
    });

    if (!record) {
      await ensureCurrentUserRecord(user);
      const created = await prisma.weComNotificationSetting.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          workspaceId: scope.workspaceId,
          accountId: scope.accountId,
          marketplace: scope.marketplace,
          settings: defaultWeComNotificationSettings as unknown as Prisma.InputJsonValue,
          sentRecords: [] as unknown as Prisma.InputJsonValue,
        },
      });

      return NextResponse.json({
        settings: normalizeWeComNotificationSettings(created.settings as Partial<WeComNotificationSettings>),
        sentRecords: normalizeWeComNotificationSentRecords(created.sentRecords),
        updatedAt: created.updatedAt.toISOString(),
      });
    }

    return NextResponse.json({
      settings: normalizeWeComNotificationSettings(record.settings as Partial<WeComNotificationSettings>),
      sentRecords: normalizeWeComNotificationSentRecords(record.sentRecords),
      updatedAt: record.updatedAt.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load WeCom settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const permission = await requireApiPermission("settings", "edit", request);
    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as WeComSettingsPayload;
    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);
    const existingRecord = await prisma.weComNotificationSetting.findUnique({
      where: {
        organizationId_workspaceId_userId: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          userId: user.id,
        },
      },
    });
    const settings =
      body.settings === undefined
        ? normalizeWeComNotificationSettings((existingRecord?.settings as Partial<WeComNotificationSettings>) ?? null)
        : parseSettings(body.settings);
    const sentRecords =
      body.sentRecords === undefined
        ? normalizeWeComNotificationSentRecords(existingRecord?.sentRecords)
        : normalizeWeComNotificationSentRecords(body.sentRecords);

    await ensureCurrentUserRecord(user);

    const saved = await prisma.weComNotificationSetting.upsert({
      where: {
        organizationId_workspaceId_userId: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          userId: user.id,
        },
      },
      create: {
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        settings: settings as unknown as Prisma.InputJsonValue,
        sentRecords: sentRecords as unknown as Prisma.InputJsonValue,
      },
      update: {
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        settings: settings as unknown as Prisma.InputJsonValue,
        sentRecords: sentRecords as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({
      settings: normalizeWeComNotificationSettings(saved.settings as Partial<WeComNotificationSettings>),
      sentRecords: normalizeWeComNotificationSentRecords(saved.sentRecords),
      updatedAt: saved.updatedAt.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save WeCom settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
