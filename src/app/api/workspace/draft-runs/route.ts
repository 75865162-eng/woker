import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

function isJsonArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("workspace", "edit", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as {
      scopeType?: string;
      campaignGroupIds?: unknown;
      campaignGroupNames?: unknown;
      rulesSnapshot?: unknown;
      overallAdDataRows?: unknown;
      overallAdDataMatchSummary?: unknown;
      drafts?: unknown;
      selectedDraftIds?: unknown;
      summary?: unknown;
      exportFileName?: string;
      exportedAt?: string;
      workspaceId?: unknown;
      accountId?: unknown;
      marketplace?: unknown;
    };
    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);

    const draftRun = await prisma.draftRun.create({
      data: {
        id: `draft-run-${randomUUID()}`,
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        scopeType: body.scopeType ?? "workspace",
        campaignGroupIds: isJsonArray(body.campaignGroupIds) ? (body.campaignGroupIds as Prisma.InputJsonValue) : [],
        campaignGroupNames: isJsonArray(body.campaignGroupNames) ? (body.campaignGroupNames as Prisma.InputJsonValue) : [],
        rulesSnapshot: body.rulesSnapshot as Prisma.InputJsonValue,
        overallAdDataRows: isJsonArray(body.overallAdDataRows) ? (body.overallAdDataRows as Prisma.InputJsonValue) : [],
        overallAdDataMatchSummary: (body.overallAdDataMatchSummary ?? {}) as Prisma.InputJsonValue,
        drafts: isJsonArray(body.drafts) ? (body.drafts as Prisma.InputJsonValue) : [],
        selectedDraftIds: isJsonArray(body.selectedDraftIds) ? (body.selectedDraftIds as Prisma.InputJsonValue) : [],
        summary: (body.summary ?? {}) as Prisma.InputJsonValue,
        exportedAt: body.exportFileName ? new Date(body.exportedAt ?? Date.now()) : null,
        exportFileName: body.exportFileName ?? null,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ draftRun });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save draft run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
