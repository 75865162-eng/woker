import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import type { SaihuHistoryAction, SaihuHistoryRecord, SaihuMergeSummary, SaihuMergedRow } from "@/lib/saihu-search-merge/types";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isAction(value: unknown): value is SaihuHistoryAction {
  return value === "upload" || value === "export";
}

function normalizeHistoryRecord(value: unknown): SaihuHistoryRecord {
  if (!isRecord(value)) {
    throw new Error("Invalid history record payload.");
  }

  if (typeof value.id !== "string" || !value.id.trim()) {
    throw new Error("History record id is required.");
  }

  if (!isAction(value.action)) {
    throw new Error("Invalid history action.");
  }

  if (typeof value.sourceFileName !== "string" || !value.sourceFileName.trim()) {
    throw new Error("Source file name is required.");
  }

  if (!isRecord(value.summary) || !Array.isArray(value.rows)) {
    throw new Error("History summary and rows are required.");
  }

  return {
    id: value.id,
    action: value.action,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    sourceFileName: value.sourceFileName,
    outputFileName: typeof value.outputFileName === "string" ? value.outputFileName : undefined,
    summary: value.summary as unknown as SaihuMergeSummary,
    rows: value.rows as SaihuMergedRow[],
  };
}

function toHistoryRecord(record: {
  id: string;
  action: string;
  createdAt: Date;
  sourceFileName: string;
  outputFileName: string | null;
  summary: unknown;
  rows: unknown;
}): SaihuHistoryRecord {
  return {
    id: record.id,
    action: isAction(record.action) ? record.action : "upload",
    createdAt: record.createdAt.toISOString(),
    sourceFileName: record.sourceFileName,
    outputFileName: record.outputFileName ?? undefined,
    summary: record.summary as SaihuMergeSummary,
    rows: Array.isArray(record.rows) ? (record.rows as SaihuMergedRow[]) : [],
  };
}

function clampPageSize(value: string | null) {
  const pageSize = Number(value) || 50;
  return Math.min(Math.max(pageSize, 1), 200);
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission(request, "searchMerge", "view");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const url = new URL(request.url);
    const scope = workspaceScopeFromRequest(request);
    const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
    const pageSize = clampPageSize(url.searchParams.get("pageSize"));
    const search = url.searchParams.get("search")?.trim();
    const where: Prisma.SaihuSearchMergeHistoryRecordWhereInput = {
      organizationId: user.organizationId,
      workspaceId: scope.workspaceId,
      ...(scope.accountId ? { accountId: scope.accountId } : {}),
      ...(scope.marketplace ? { marketplace: scope.marketplace } : {}),
      ...(search
        ? {
            OR: [
              { sourceFileName: { contains: search, mode: "insensitive" } },
              { outputFileName: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [total, records] = await Promise.all([
      prisma.saihuSearchMergeHistoryRecord.count({ where }),
      prisma.saihuSearchMergeHistoryRecord.findMany({
        where,
      orderBy: {
        createdAt: "desc",
      },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({
      records: records.map(toHistoryRecord),
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load history records.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission(request, "searchMerge", "create");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as { record?: unknown; workspaceId?: unknown; accountId?: unknown; marketplace?: unknown };
    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);
    const record = normalizeHistoryRecord(body.record);

    await prisma.saihuSearchMergeHistoryRecord.upsert({
      where: {
        id: record.id,
      },
      create: {
        id: record.id,
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        action: record.action,
        sourceFileName: record.sourceFileName,
        outputFileName: record.outputFileName,
        createdAt: new Date(record.createdAt),
        summary: record.summary as unknown as Prisma.InputJsonValue,
        rows: record.rows as unknown as Prisma.InputJsonValue,
      },
      update: {
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        action: record.action,
        sourceFileName: record.sourceFileName,
        outputFileName: record.outputFileName,
        createdAt: new Date(record.createdAt),
        summary: record.summary as unknown as Prisma.InputJsonValue,
        rows: record.rows as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ record });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save history record.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const permission = await requireApiPermission(request, "searchMerge", "edit");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const scope = workspaceScopeFromRequest(request);
    await prisma.saihuSearchMergeHistoryRecord.deleteMany({
      where: {
        organizationId: user.organizationId,
        workspaceId: scope.workspaceId,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clear history records.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
