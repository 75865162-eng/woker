import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordDataChangeVersion } from "@/lib/audit/versioning";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import {
  createPersistableDraft,
  createTitleGeneratorModeDraft,
  initialCompetitors,
  initialImageGenerator,
  initialInput,
  initialTitleGenerator,
  type SavedRecord,
  type TitleGeneratorDraft,
  type TitleGeneratorField,
  type TitleGeneratorMode,
  type TitleGeneratorModeDraft,
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

function mergeTitleGeneratorFields(fields: unknown): TitleGeneratorField[] {
  const savedFields = Array.isArray(fields) ? fields.filter(isRecord) : [];

  return initialTitleGenerator.fields.map((field) => ({
    ...field,
    ...savedFields.find((savedField) => savedField.key === field.key),
  }));
}

function normalizeTitleGeneratorModeDraft(
  value: unknown,
  legacyDraft?: Partial<TitleGeneratorDraft>,
): TitleGeneratorModeDraft {
  const draft = isRecord(value) ? value : {};

  return {
    ...createTitleGeneratorModeDraft(),
    fields: mergeTitleGeneratorFields(draft.fields ?? legacyDraft?.fields),
    results: Array.isArray(draft.results)
      ? draft.results.filter((item): item is string => typeof item === "string")
      : Array.isArray(legacyDraft?.results)
        ? legacyDraft.results
        : [],
    history: Array.isArray(draft.history)
      ? draft.history.filter(isRecord).map((record) => ({
          id: typeof record.id === "string" ? record.id : crypto.randomUUID(),
          createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toLocaleString("zh-CN", { hour12: false }),
          mode: record.mode === "new" ? "new" : "old",
          fields: mergeTitleGeneratorFields(record.fields),
          prompt: typeof record.prompt === "string" ? record.prompt : initialTitleGenerator.prompt,
          results: Array.isArray(record.results)
            ? record.results.filter((item): item is string => typeof item === "string")
            : [],
        }))
      : Array.isArray(legacyDraft?.history)
        ? legacyDraft.history
        : [],
  };
}

function normalizeTitleGeneratorDraft(value: unknown): TitleGeneratorDraft {
  const draft = isRecord(value) ? (value as Partial<TitleGeneratorDraft>) : {};
  const mode: TitleGeneratorMode = draft.mode === "new" ? "new" : "old";
  const modes: Record<string, unknown> = isRecord(draft.modes) ? draft.modes : {};
  const oldDraft = normalizeTitleGeneratorModeDraft(
    modes.old,
    mode === "old" ? draft : undefined,
  );
  const newDraft = normalizeTitleGeneratorModeDraft(
    modes.new,
    mode === "new" ? draft : undefined,
  );
  const activeDraft = mode === "new" ? newDraft : oldDraft;

  return {
    ...initialTitleGenerator,
    ...draft,
    mode,
    prompt: typeof draft.prompt === "string" && draft.prompt.trim() ? draft.prompt : initialTitleGenerator.prompt,
    fields: activeDraft.fields,
    results: activeDraft.results,
    history: activeDraft.history,
    modes: {
      old: oldDraft,
      new: newDraft,
    },
  };
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
    titleGenerator: normalizeTitleGeneratorDraft(draft.titleGenerator),
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
