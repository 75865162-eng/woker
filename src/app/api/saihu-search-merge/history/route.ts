import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import type { SaihuHistoryAction, SaihuHistoryRecord, SaihuMergeSummary, SaihuMergedRow } from "@/lib/saihu-search-merge/types";

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

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const records = await prisma.saihuSearchMergeHistoryRecord.findMany({
      where: {
        organizationId: user.organizationId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 200,
    });

    return NextResponse.json({ records: records.map(toHistoryRecord) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load history records.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = (await request.json()) as { record?: unknown };
    const record = normalizeHistoryRecord(body.record);

    await prisma.saihuSearchMergeHistoryRecord.upsert({
      where: {
        id: record.id,
      },
      create: {
        id: record.id,
        organizationId: user.organizationId,
        userId: user.id,
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

export async function DELETE() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    await prisma.saihuSearchMergeHistoryRecord.deleteMany({
      where: {
        organizationId: user.organizationId,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clear history records.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
