import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordDataChangeVersion } from "@/lib/audit/versioning";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function jsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("workspace", "edit");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as Record<string, unknown>;
    const scope = workspaceScopeFromRequest(request, body);
    const drafts = jsonArray(body.drafts);
    const campaignGroupIds = jsonArray(body.campaignGroupIds);

    if (!drafts.length || !campaignGroupIds.length) {
      return NextResponse.json({ error: "Draft run requires campaign groups and drafts." }, { status: 400 });
    }

    const datasetId = typeof body.datasetId === "string" && body.datasetId ? body.datasetId : undefined;
    const fileId = typeof body.fileId === "string" && body.fileId ? body.fileId : undefined;
    const scopeType = typeof body.scopeType === "string" && body.scopeType ? body.scopeType : "campaign";
    const summary = isRecord(body.summary) ? body.summary : {};

    const draftRun = await prisma.draftRun.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        datasetId,
        fileId,
        scopeType,
        campaignGroupIds: campaignGroupIds as unknown as Prisma.InputJsonValue,
        campaignGroupNames: jsonArray(body.campaignGroupNames) as unknown as Prisma.InputJsonValue,
        rulesSnapshot: jsonArray(body.rulesSnapshot) as unknown as Prisma.InputJsonValue,
        overallAdDataRows: jsonArray(body.overallAdDataRows) as unknown as Prisma.InputJsonValue,
        overallAdDataMatchSummary: (isRecord(body.overallAdDataMatchSummary) ? body.overallAdDataMatchSummary : {}) as Prisma.InputJsonValue,
        drafts: drafts as unknown as Prisma.InputJsonValue,
        selectedDraftIds: jsonArray(body.selectedDraftIds) as unknown as Prisma.InputJsonValue,
        summary: summary as Prisma.InputJsonValue,
      },
    });

    await recordDataChangeVersion({
      user,
      entityType: "draft_run",
      entityId: draftRun.id,
      action: "draft_run_create",
      summary: `规则运行 ${drafts.length} 条草稿`,
      payload: {
        draftRunId: draftRun.id,
        datasetId,
        fileId,
        scopeType,
        campaignGroupIds,
        draftCount: drafts.length,
        summary,
      } as Prisma.InputJsonValue,
      scope,
    });

    return NextResponse.json({ draftRun });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record draft run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
