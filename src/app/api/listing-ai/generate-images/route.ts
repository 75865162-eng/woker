import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { generateListingAiImages, type ImageGeneratorRequest } from "@/lib/listing-ai/image-generation";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("listingAi", "create");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as ImageGeneratorRequest;
    const scope = workspaceScopeFromRequest(request);
    const images = await generateListingAiImages(body, user, scope);
    return NextResponse.json({ images });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "图片生成失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
