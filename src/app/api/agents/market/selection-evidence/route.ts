import { randomUUID, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { parseSelectionEvidence, SelectionEvidenceError, selectionEvidenceMaxBytes } from "@/lib/agent-platform/selection-evidence";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    // Octet-stream keeps authentication from cloning/parsing an unbounded JSON body.
    if (request.headers.get("content-type")?.split(";")[0] !== "application/octet-stream") return NextResponse.json({ error: "请上传原始 draft.json 文件。" }, { status: 415 });
    const permission = await requireApiPermission("agents", "create", request);
    if (!permission.ok) return permission.response;
    const { user } = permission;
    const scope = workspaceScopeFromRequest(request);
    if (Number(request.headers.get("content-length")) > selectionEvidenceMaxBytes) throw new SelectionEvidenceError("选品草稿超过 2 MB。", 413);
    if (!request.body) throw new SelectionEvidenceError("缺少选品草稿。");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > selectionEvidenceMaxBytes) throw new SelectionEvidenceError("选品草稿超过 2 MB。", 413);
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = Buffer.concat(chunks);
    let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new SelectionEvidenceError("选品草稿不是有效 JSON。"); }
    const evidence = parseSelectionEvidence(value);
    // Store only the sanitized research slice; formal product fields, file paths and secrets are discarded.
    const storedBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, fixture: false, slug: evidence.slug,
      brief: { keyword: evidence.keyword, priceMin: evidence.priceMin, priceMax: evidence.priceMax },
      competitors: evidence.competitors, tags: { matches: evidence.tags }, suppliers: evidence.suppliers }));
    const storage = getStorageDriver();
    const key = `agent-selection/${randomUUID()}.json`;
    const object = await storage.putBuffer({ key, buffer: storedBytes, contentType: "application/json" });
    let file;
    try {
      file = await prisma.fileObject.create({ data: {
        organizationId: user.organizationId, userId: user.id, workspaceId: scope.workspaceId,
        accountId: scope.accountId, marketplace: "US", originalName: `${evidence.slug}.json`,
        mimeType: "application/json", size: object.size, storageKey: object.key, storageType: getStorageType(), status: "done",
      } });
    } catch (error) {
      await storage.delete(object.key).catch(() => console.warn("Selection evidence cleanup failed."));
      throw error;
    }
    return NextResponse.json({ fileId: file.id, keyword: evidence.keyword, marketplace: "US", sha256: createHash("sha256").update(storedBytes).digest("hex") }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SelectionEvidenceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Selection evidence upload failed.");
    return NextResponse.json({ error: "保存选品证据失败，请重试。" }, { status: 500 });
  }
}
