import { NextResponse } from "next/server";
import { requireAccessView } from "@/lib/accounts/access-api-guard";
import { getAccessMatrix } from "@/lib/accounts/access-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = await requireAccessView(request);
  if (!guard.ok) return guard.response;
  const matrix = await getAccessMatrix({
    organizationId: guard.user.organizationId,
    workspaceId: guard.workspaceId,
  });
  return NextResponse.json(matrix);
}
