import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { isDatabaseUnavailableError } from "@/lib/db/is-database-unavailable-error";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const maxContentLength = 10_000;

function toMeetingNote(record: { id: string; content: string; createdAt: Date; updatedAt: Date; user: { name: string } }) {
  return {
    id: record.id,
    content: record.content,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    authorName: record.user.name,
  };
}

function parseContent(value: unknown) {
  if (typeof value !== "string") throw new Error("会议记录内容必须是文本。");
  if (value.length > maxContentLength) throw new Error(`会议记录不能超过 ${maxContentLength} 个字符。`);
  return value;
}

async function findProductRecord(organizationId: string, workspaceId: string, sku: string) {
  return prisma.productRecord.findFirst({
    where: { organizationId, workspaceId, sku: sku.trim() },
    select: { id: true },
  });
}

function unavailableResponse() {
  return NextResponse.json({ error: "会议记录服务暂时不可用，请稍后重试。" }, { status: 503 });
}

function tableMissingResponse(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : "";

  if (code === "P2021" || message.includes("ProductMeetingNote") && message.includes("does not exist")) {
    return NextResponse.json({ error: "会议记录尚未初始化，请先应用数据库迁移。" }, { status: 503 });
  }

  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  try {
    const permission = await requireApiPermission("products", "view", request);
    if (!permission.ok) return permission.response;

    const { sku } = await params;
    const scope = workspaceScopeFromRequest(request);
    const productRecord = await findProductRecord(permission.user.organizationId, scope.workspaceId, sku);
    if (!productRecord) return NextResponse.json({ error: "商品不存在。" }, { status: 404 });

    const notes = await prisma.productMeetingNote.findMany({
      where: { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, productRecordId: productRecord.id },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ notes: notes.map(toMeetingNote) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) return unavailableResponse();
    const missingTable = tableMissingResponse(error);
    if (missingTable) return missingTable;
    const message = error instanceof Error ? error.message : "读取会议记录失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  try {
    const permission = await requireApiPermission("products", "edit", request);
    if (!permission.ok) return permission.response;

    const { sku } = await params;
    const body = (await request.json().catch(() => ({}))) as { content?: unknown };
    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);
    const productRecord = await findProductRecord(permission.user.organizationId, scope.workspaceId, sku);
    if (!productRecord) return NextResponse.json({ error: "商品不存在。" }, { status: 404 });

    const note = await prisma.productMeetingNote.create({
      data: {
        organizationId: permission.user.organizationId,
        workspaceId: scope.workspaceId,
        productRecordId: productRecord.id,
        userId: permission.user.id,
        content: body.content === undefined ? "" : parseContent(body.content),
      },
      include: { user: { select: { name: true } } },
    });
    return NextResponse.json({ note: toMeetingNote(note) }, { status: 201 });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) return unavailableResponse();
    const missingTable = tableMissingResponse(error);
    if (missingTable) return missingTable;
    const message = error instanceof Error ? error.message : "新建会议记录失败。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  try {
    const permission = await requireApiPermission("products", "edit", request);
    if (!permission.ok) return permission.response;

    const { sku } = await params;
    const body = (await request.json().catch(() => ({}))) as { id?: unknown; content?: unknown };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ error: "缺少会议记录标识。" }, { status: 400 });
    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);
    const productRecord = await findProductRecord(permission.user.organizationId, scope.workspaceId, sku);
    if (!productRecord) return NextResponse.json({ error: "商品不存在。" }, { status: 404 });

    const result = await prisma.productMeetingNote.updateMany({
      where: { id, organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, productRecordId: productRecord.id },
      data: { content: parseContent(body.content) },
    });
    if (!result.count) return NextResponse.json({ error: "会议记录不存在。" }, { status: 404 });

    const note = await prisma.productMeetingNote.findFirstOrThrow({
      where: { id, organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, productRecordId: productRecord.id },
      include: { user: { select: { name: true } } },
    });
    return NextResponse.json({ note: toMeetingNote(note) });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) return unavailableResponse();
    const missingTable = tableMissingResponse(error);
    if (missingTable) return missingTable;
    const message = error instanceof Error ? error.message : "保存会议记录失败。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  try {
    const permission = await requireApiPermission("products", "edit", request);
    if (!permission.ok) return permission.response;

    const { sku } = await params;
    const url = new URL(request.url);
    const id = url.searchParams.get("id")?.trim();
    if (!id) return NextResponse.json({ error: "缺少会议记录标识。" }, { status: 400 });
    const scope = workspaceScopeFromRequest(request);
    const productRecord = await findProductRecord(permission.user.organizationId, scope.workspaceId, sku);
    if (!productRecord) return NextResponse.json({ error: "商品不存在。" }, { status: 404 });

    await prisma.productMeetingNote.deleteMany({
      where: { id, organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, productRecordId: productRecord.id },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) return unavailableResponse();
    const missingTable = tableMissingResponse(error);
    if (missingTable) return missingTable;
    const message = error instanceof Error ? error.message : "删除会议记录失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
