import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { findSkillView } from "@/lib/skill-engine/config";
import { SKILL_MODULE_ID } from "@/lib/skill-engine/types";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const permission = await requireApiPermission(SKILL_MODULE_ID, "view", request);
  if (!permission.ok) return permission.response;
  const { slug } = await context.params;
  const skill = findSkillView(slug);
  if (!skill) return NextResponse.json({ error: "未找到该 Skill。" }, { status: 404 });
  return NextResponse.json({ skill }, { headers: { "Cache-Control": "no-store" } });
}
