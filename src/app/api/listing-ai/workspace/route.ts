import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
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

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const workspace = await prisma.listingAiWorkspace.findUnique({
      where: {
        userId: user.id,
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
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = (await request.json()) as WorkspacePayload;
    const draft = normalizeDraft(body.draft);
    const records = normalizeRecords(body.records);

    await prisma.listingAiWorkspace.upsert({
      where: {
        userId: user.id,
      },
      create: {
        organizationId: user.organizationId,
        userId: user.id,
        draft: draft as unknown as Prisma.InputJsonValue,
        records: records as unknown as Prisma.InputJsonValue,
      },
      update: {
        organizationId: user.organizationId,
        draft: draft as unknown as Prisma.InputJsonValue,
        records: records as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ draft, records });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save Listing AI workspace.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
