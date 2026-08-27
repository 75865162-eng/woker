import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { generateListingAiChatReply, type ListingAiChatRequest } from "@/lib/listing-ai/chat";
import { generateListingAiImages, hydrateImagePreviews } from "@/lib/listing-ai/image-generation";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

interface ChatAttachmentPayload {
  name: string;
  url?: string;
  assetId?: string;
}

interface ChatRequest extends Omit<ListingAiChatRequest, "referenceImages"> {
  mode?: "text" | "image";
  referenceImages?: ChatAttachmentPayload[];
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("listingAi", "create", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as ChatRequest;
    const mode = body.mode === "image" ? "image" : "text";
    const scope = workspaceScopeFromRequest(request);
    const referenceImages = Array.isArray(body.referenceImages)
      ? body.referenceImages.filter(
          (image): image is ChatAttachmentPayload =>
            Boolean(image?.assetId || image?.url?.startsWith("data:image/")),
        )
      : [];

    if (mode === "image") {
      const prompt = body.prompt?.trim();

      if (!prompt) {
        return NextResponse.json({ error: "提示词不能为空。" }, { status: 400 });
      }

      if (!referenceImages.length) {
        return NextResponse.json({ error: "请先添加图片附件，再生成图片。" }, { status: 400 });
      }

      const images = await generateListingAiImages(
        {
          prompt,
          competitorImages: referenceImages.map((image) => ({
            name: image.name,
            url: image.url || "",
            assetId: image.assetId,
          })),
        },
        user,
        scope,
      );

      return NextResponse.json({ mode, images });
    }

    const result = await generateListingAiChatReply({
      ...body,
      referenceImages: await hydrateImagePreviews(
        referenceImages.map((image) => ({
          name: image.name,
          url: image.url || "",
          assetId: image.assetId,
        })),
        user,
      ),
    });
    return NextResponse.json({ mode, reply: result.reply });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "对话请求失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
