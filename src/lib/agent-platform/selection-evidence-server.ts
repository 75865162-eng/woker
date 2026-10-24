import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";
import { SelectionEvidenceError, selectionEvidenceMaxBytes } from "./selection-evidence";

/** Identity is supplied by the authenticated route, never the tool context or uploaded JSON. */
export function selectionEvidenceLoader(scope: { organizationId: string; workspaceId: string }) {
  return async (fileId: string) => {
    if (!fileId || fileId.length > 200) throw new SelectionEvidenceError("请先上传 Round B draft.json。");
    const file = await prisma.fileObject.findFirst({ where: {
      id: fileId, organizationId: scope.organizationId, workspaceId: scope.workspaceId,
      status: "done", mimeType: "application/json", storageKey: { startsWith: "agent-selection/" },
    } });
    if (!file) throw new SelectionEvidenceError("当前组织/工作区没有该选品证据。", 404);
    if (file.size == null || file.size > selectionEvidenceMaxBytes) throw new SelectionEvidenceError("选品草稿超过 2 MB。", 413);
    const bytes = await getStorageDriver().getBuffer(file.storageKey);
    if (bytes.length > selectionEvidenceMaxBytes) throw new SelectionEvidenceError("选品草稿超过 2 MB。", 413);
    let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new SelectionEvidenceError("选品草稿不是有效 JSON。"); }
    return { value, source: { fileId: file.id, sha256: createHash("sha256").update(bytes).digest("hex") } };
  };
}
