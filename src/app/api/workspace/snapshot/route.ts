import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordDataChangeVersion } from "@/lib/audit/versioning";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission(request, "workspace", "view");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const scope = workspaceScopeFromRequest(request);
    const record = await prisma.workspaceSnapshot.findUnique({
      where: {
        organizationId_workspaceId_userId: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          userId: user.id,
        },
      },
    });

    if (!record) {
      return NextResponse.json({ snapshot: null });
    }

    return NextResponse.json({
      version: record.version,
      savedAt: record.savedAt.toISOString(),
      snapshot: record.snapshot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load workspace snapshot.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const permission = await requireApiPermission(request, "workspace", "edit");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as { version?: unknown; snapshot?: unknown; workspaceId?: unknown; accountId?: unknown; marketplace?: unknown };
    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);

    if (!isJsonObject(body.snapshot)) {
      return NextResponse.json({ error: "Invalid workspace snapshot payload." }, { status: 400 });
    }

    const version = Number(body.version) || 1;
    const savedAt = new Date();

    await prisma.workspaceSnapshot.upsert({
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
        version,
        savedAt,
        snapshot: body.snapshot as Prisma.InputJsonValue,
      },
      update: {
        organizationId: user.organizationId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        version,
        savedAt,
        snapshot: body.snapshot as Prisma.InputJsonValue,
      },
    });
    await recordDataChangeVersion({
      user,
      entityType: "ppc_workspace_snapshot",
      entityId: `${scope.workspaceId}:${user.id}`,
      action: "ppc_workspace_snapshot_save",
      summary: `PPC 工作区快照 v${version}`,
      payload: body.snapshot as Prisma.InputJsonValue,
      scope,
    });

    const snapshot = body.snapshot as Record<string, unknown>;
    if (Array.isArray(snapshot.rules)) {
      await recordDataChangeVersion({
        user,
        entityType: "rule_config",
        entityId: `${scope.workspaceId}:rules`,
        action: "rule_config_save",
        summary: `规则配置 ${snapshot.rules.length} 条`,
        payload: snapshot.rules as unknown as Prisma.InputJsonValue,
        scope,
      });
    }

    return NextResponse.json({ version, savedAt: savedAt.toISOString(), snapshot: body.snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save workspace snapshot.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const permission = await requireApiPermission(request, "workspace", "edit");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const scope = workspaceScopeFromRequest(request);
    await prisma.workspaceSnapshot.deleteMany({
      where: {
        organizationId: user.organizationId,
        workspaceId: scope.workspaceId,
        userId: user.id,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete workspace snapshot.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
