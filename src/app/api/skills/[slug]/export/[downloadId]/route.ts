import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { SKILL_MODULE_ID } from "@/lib/skill-engine/types";
import { getReport } from "@/lib/skill-engine/report-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string; downloadId: string }> },
) {
  const permission = await requireApiPermission(SKILL_MODULE_ID, "view", request);
  if (!permission.ok) return permission.response;
  const { downloadId } = await context.params;
  const entry = getReport(downloadId);
  if (!entry) return NextResponse.json({ error: "下载链接已失效，请重新运行生成报告。" }, { status: 404 });

  const body = new Uint8Array(entry.bytes);
  return new Response(body, {
    headers: {
      "Content-Type": CONTENT_TYPES[entry.format],
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(entry.fileName)}`,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
