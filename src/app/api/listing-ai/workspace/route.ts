import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordDataChangeVersion } from "@/lib/audit/versioning";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import {
  createPersistableDraft,
  initialCompetitors,
  initialImageGenerator,
  initialInput,
  initialTitleGenerator,
  type SavedRecord,
  type WorkspaceDraft,
} from "@/lib/listing-ai/workspace-draft";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

type WorkspacePayload = {
  draft?: unknown;
  records?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeDraft(value: unknown): WorkspaceDraft {
  const draft = isRecord(value) ? (value as Partial<WorkspaceDraft>) : {};

  return createPersistableDraft({
    input: {
      ...initialInput,
      ...(isRecord(draft.input) ? draft.input : {}),
    },
    competitors: initialCompetitors.map((competitor, index) => ({
      ...competitor,
      ...(Array.isArray(draft.competitors) && isRecord(draft.competitors[index]) ? draft.competitors[index] : {}),
    })),
    ownImages: {
      structureNotes: "",
      mainImage: [],
      images: [],
      imageNotes: [],
      sales: "",
      price: "",
      rating: "",
      reviewCount: "",
      ...(isRecord(draft.ownImages) ? draft.ownImages : {}),
    },
    titleGenerator: {
      ...initialTitleGenerator,
      ...(isRecord(draft.titleGenerator) ? draft.titleGenerator : {}),
      fields: initialTitleGenerator.fields.map((field) => ({
        ...field,
        ...(isRecord(draft.titleGenerator) && Array.isArray(draft.titleGenerator.fields)
          ? draft.titleGenerator.fields.find((savedField) => isRecord(savedField) && savedField.key === field.key)
          : {}),
      })),
    },
    imageGenerator: {
      ...initialImageGenerator,
      ...(isRecord(draft.imageGenerator) ? draft.imageGenerator : {}),
      ownViews: {
        ...initialImageGenerator.ownViews,
        ...(isRecord(draft.imageGenerator) && isRecord(draft.imageGenerator.ownViews) ? draft.imageGenerator.ownViews : {}),
      },
    },
    activeTab: draft.activeTab === "visual" || draft.activeTab === "analysis" || draft.activeTab === "listing" || draft.activeTab === "imagePlan" || draft.activeTab === "review" ? draft.activeTab : "input",
  });
}

function normalizeRecords(value: unknown): SavedRecord[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(isRecord)
    .filter((record) => typeof record.id === "string" && isRecord(record.input) && isRecord(record.result))
    .map((record) => ({
      id: record.id as string,
      version: Number(record.version) || 1,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toLocaleString("zh-CN", { hour12: false }),
      submitter: typeof record.submitter === "string" ? record.submitter : "未填写",
      productName: typeof record.productName === "string" ? record.productName : "未命名产品",
      input: {
        ...initialInput,
        ...(record.input as object),
      },
      result: record.result as SavedRecord["result"],
    }))
    .slice(0, 50);
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("listingAi", "view");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const scope = workspaceScopeFromRequest(request);
    const workspace = await prisma.listingAiWorkspace.findUnique({
      where: {
        organizationId_workspaceId_userId: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          userId: user.id,
        },
      },
    });

    if (!workspace) {
      return NextResponse.json({ draft: null, records: [] });
    }

    return NextResponse.json({
      draft: normalizeDraft(workspace.draft),
      records: normalizeRecords(workspace.records),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load Listing AI workspace.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const permission = await requireApiPermission("listingAi", "edit");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as WorkspacePayload;
    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);
    const draft = normalizeDraft(body.draft);
    const records = normalizeRecords(body.records);

    await prisma.listingAiWorkspace.upsert({
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
        draft: draft as unknown as Prisma.InputJsonValue,
        records: records as unknown as Prisma.InputJsonValue,
      },
      update: {
        organizationId: user.organizationId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        draft: draft as unknown as Prisma.InputJsonValue,
        records: records as unknown as Prisma.InputJsonValue,
      },
    });
    await recordDataChangeVersion({
      user,
      entityType: "listing_ai_workspace",
      entityId: `${scope.workspaceId}:${user.id}`,
      action: "listing_ai_workspace_save",
      summary: `Listing AI 草稿，历史 ${records.length} 条`,
      payload: { draft, records } as unknown as Prisma.InputJsonValue,
      scope,
    });

    return NextResponse.json({ draft, records });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save Listing AI workspace.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
