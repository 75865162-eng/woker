import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { listSkillCategories, listSkillViews } from "@/lib/skill-engine/config";
import { SKILL_MODULE_ID } from "@/lib/skill-engine/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const permission = await requireApiPermission(SKILL_MODULE_ID, "view", request);
  if (!permission.ok) return permission.response;
  return NextResponse.json(
    { skills: listSkillViews(), categories: listSkillCategories() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
