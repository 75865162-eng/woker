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

function jsonArray(value: unknown): Prisma.InputJsonValue {
  return isJsonArray(value) ? (value as Prisma.InputJsonValue) : [];
}

function jsonObject(value: unknown): Prisma.InputJsonValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Prisma.InputJsonValue) : {};
}

function optionalDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("workspace", "view", request);

    if (!permission.ok) {
      return permission.response;
    }

    const { user } = permission;
    const url = new URL(request.url);
    const scope = workspaceScopeFromRequest(request);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 200);
    const draftRuns = await prisma.draftRun.findMany({
      where: {
        organizationId: user.organizationId,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      draftRuns: draftRuns.map((run) => ({
        ...run,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
        exportedAt: run.exportedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load draft runs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("workspace", "edit", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as {
      id?: unknown;
      ranAt?: unknown;
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
    const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : `draft-run-${randomUUID()}`;
    const createdAt = optionalDate(body.ranAt);

    const draftRun = await prisma.draftRun.upsert({
      where: { id },
      create: {
        id,
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        scopeType: body.scopeType ?? "workspace",
        campaignGroupIds: jsonArray(body.campaignGroupIds),
        campaignGroupNames: jsonArray(body.campaignGroupNames),
        rulesSnapshot: jsonObject(body.rulesSnapshot),
        overallAdDataRows: jsonArray(body.overallAdDataRows),
        overallAdDataMatchSummary: jsonObject(body.overallAdDataMatchSummary),
        drafts: jsonArray(body.drafts),
        selectedDraftIds: jsonArray(body.selectedDraftIds),
        summary: jsonObject(body.summary),
        createdAt,
        exportedAt: body.exportFileName ? new Date(body.exportedAt ?? Date.now()) : null,
        exportFileName: body.exportFileName ?? null,
        updatedAt: new Date(),
      },
      update: {
        campaignGroupIds: jsonArray(body.campaignGroupIds),
        campaignGroupNames: jsonArray(body.campaignGroupNames),
        rulesSnapshot: jsonObject(body.rulesSnapshot),
        overallAdDataRows: jsonArray(body.overallAdDataRows),
        overallAdDataMatchSummary: jsonObject(body.overallAdDataMatchSummary),
        drafts: jsonArray(body.drafts),
        selectedDraftIds: jsonArray(body.selectedDraftIds),
        summary: jsonObject(body.summary),
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
