import { NextResponse } from "next/server";
import { requireAccessView } from "@/lib/accounts/access-api-guard";
import { previewAccessChanges, type GrantChange, type SubjectType } from "@/lib/accounts/access-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const guard = await requireAccessView(request);
  if (!guard.ok) return guard.response;
  const body = (await request.json()) as { subjectType?: string; subjectId?: string; changes?: GrantChange[] };
  const subjectType = body.subjectType === "ROLE" || body.subjectType === "MEMBER" ? body.subjectType : null;
  const subjectId = body.subjectId?.trim();
  if (!subjectType || !subjectId || !Array.isArray(body.changes)) {
    return NextResponse.json({ error: "subject / changes 参数无效。" }, { status: 400 });
  }
  const preview = await previewAccessChanges({
    organizationId: guard.user.organizationId,
    workspaceId: guard.workspaceId,
    subjectType: subjectType as SubjectType,
    subjectId,
    changes: body.changes,
  });
  return NextResponse.json(preview);
}
