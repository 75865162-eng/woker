import { Prisma, type PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";
import type { CurrentUser } from "@/lib/auth/session";
import type { WorkspaceScopeInput } from "@/lib/workspace/scope";

function jsonArray(value: unknown): Prisma.InputJsonValue {
  return Array.isArray(value) ? value as Prisma.InputJsonValue : [];
}

function jsonObject(value: unknown): Prisma.InputJsonValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Prisma.InputJsonValue : {};
}

export class DraftRunIdConflictError extends Error {
  readonly status = 409;
  constructor() { super("Draft run ID is unavailable."); }
}

export function draftRunSaveErrorResponse(error: unknown): Response | null {
  return error instanceof DraftRunIdConflictError
    ? NextResponse.json({ error: "草稿记录冲突，请刷新后重试。" }, { status: 409 })
    : null;
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export async function saveDraftRun(input: {
  db: Pick<PrismaClient, "$transaction">;
  id: string;
  user: Pick<CurrentUser, "id" | "organizationId">;
  scope: WorkspaceScopeInput;
  body: Record<string, unknown>;
  createdAt: Date | undefined;
}) {
  const { db, id, user, scope, body, createdAt } = input;
  const scopeType = typeof body.scopeType === "string" ? body.scopeType : "workspace";
  const exportFileName = typeof body.exportFileName === "string" ? body.exportFileName : null;
  const exportedAt = exportFileName ? new Date(typeof body.exportedAt === "string" ? body.exportedAt : Date.now()) : null;
  try {
    return await db.$transaction(async tx => {
      const where = { id, organizationId: user.organizationId, userId: user.id, ...scope };
      const updated = await tx.draftRun.updateMany({ where, data: {
        campaignGroupIds: jsonArray(body.campaignGroupIds), campaignGroupNames: jsonArray(body.campaignGroupNames),
        rulesSnapshot: jsonObject(body.rulesSnapshot), overallAdDataRows: jsonArray(body.overallAdDataRows),
        overallAdDataMatchSummary: jsonObject(body.overallAdDataMatchSummary), drafts: jsonArray(body.drafts),
        selectedDraftIds: jsonArray(body.selectedDraftIds), summary: jsonObject(body.summary),
        exportedAt, exportFileName, updatedAt: new Date(),
      } });
      if (updated.count) return tx.draftRun.findFirstOrThrow({ where });
      return tx.draftRun.create({ data: {
        id, organizationId: user.organizationId, userId: user.id, workspaceId: scope.workspaceId,
        accountId: scope.accountId, marketplace: scope.marketplace, scopeType,
        campaignGroupIds: jsonArray(body.campaignGroupIds), campaignGroupNames: jsonArray(body.campaignGroupNames),
        rulesSnapshot: jsonObject(body.rulesSnapshot), overallAdDataRows: jsonArray(body.overallAdDataRows),
        overallAdDataMatchSummary: jsonObject(body.overallAdDataMatchSummary), drafts: jsonArray(body.drafts),
        selectedDraftIds: jsonArray(body.selectedDraftIds), summary: jsonObject(body.summary),
        createdAt, exportedAt, exportFileName, updatedAt: new Date(),
      } });
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) throw new DraftRunIdConflictError();
    throw error;
  }
}
