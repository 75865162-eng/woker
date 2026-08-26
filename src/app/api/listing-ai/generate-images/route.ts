import { NextResponse } from "next/server";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { type AiModelSettings } from "@/lib/ai-settings";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { type CurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { fetchAiApi, type AiFetchResponse } from "@/lib/server/ai-fetch";
import { buildAiTextEndpoint, resolveAiSettings } from "@/lib/server/ai-runtime";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import { workspaceScopeFromRequest, type WorkspaceScopeInput } from "@/lib/workspace/scope";

export const runtime = "nodejs";

interface ImagePreviewPayload {
  name: string;
  url: string;
  assetId?: string;
}

interface ImageGeneratorRequest {
  ownViews?: Record<string, ImagePreviewPayload[]>;
  competitorImages?: ImagePreviewPayload[];
  prompt?: string;
  aiSettings?: Partial<AiModelSettings>;
}

interface ResponsesImageOutput {
  output?: Array<{
    type?: string;
    result?: string;
    content?: Array<{
      type?: string;
      image_url?: string;
      url?: string;
      b64_json?: string;
    }>;
  }>;
  data?: Array<{
    url?: string;
    b64_json?: string;
  }>;
}

interface ImageGenerationsOutput {
  data?: Array<{
    url?: string;
    b64_json?: string;
  }>;
}

function getImageContentType(keyOrName: string) {
  const contentTypes: Record<string, string> = {
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };

  return contentTypes[path.extname(keyOrName).toLowerCase()] ?? "image/png";
}

function createAssetUrl(key: string) {
  return `/api/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function isValidAssetKey(key: string) {
  const parts = key.split("/");

  return (
    parts.length > 1 &&
    parts[0] === "assets" &&
    parts.every((part) => part !== "" && part !== "." && part !== ".." && !part.includes("\\"))
  );
}

function createGeneratedAssetKey(name: string) {
  const extension = path.extname(name).toLowerCase() || ".png";
  return `assets/listing-ai/generated/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
}

async function imageAssetToDataUrl(assetId: string, user: CurrentUser) {
  if (process.env.DATABASE_URL) {
    const asset = await prisma.fileObject.findFirst({
      where: {
        storageKey: assetId,
        organizationId: user.organizationId,
      },
    });

    if (!asset) {
      return "";
    }
  }

  const buffer = await getStorageDriver().getBuffer(assetId);
  return `data:${getImageContentType(assetId)};base64,${buffer.toString("base64")}`;
}

async function flattenImages(body: ImageGeneratorRequest, user: CurrentUser) {
  const ownViews = Object.entries(body.ownViews ?? {}).flatMap(
    ([view, images]) =>
      (Array.isArray(images) ? images : []).map((image) => ({
        ...image,
        role: `own ${view} view`,
      })),
  );
  const competitorImages = (body.competitorImages ?? []).map((image) => ({
    ...image,
    role: "competitor reference",
  }));

  const images = [...ownViews, ...competitorImages];
  const hydratedImages = await Promise.all(
    images.map(async (image) => {
      if (image.url?.startsWith("data:image/")) {
        return image;
      }

      if (image.assetId && isValidAssetKey(image.assetId)) {
        return {
          ...image,
          url: await imageAssetToDataUrl(image.assetId, user),
        };
      }

      return image;
    }),
  );

  return hydratedImages.filter((image) => image.url?.startsWith("data:image/"));
}

function buildImagePrompt(prompt: string) {
  return `${prompt}

系统执行约束：
请生成 1 张全新的 Amazon 主图/副图级商业产品图片。我的产品多角度实拍图是唯一产品主体参考，必须保持真实形状、尺寸比例、颜色、纹理、材质和结构特点。竞品图片只能作为拍摄角度、场景氛围、光线方向、使用方式、构图布局和商业摄影风格参考。不得复制竞品产品外形、颜色组合、纹理、包装、Logo、文字、品牌标识、专利结构或独特设计元素。不得改变我的产品结构，不得增加不存在的功能，不得夸大尺寸，不得生成 AI 幻觉细节。如果参考图无法识别，不要自行发明食品、鱼类、屠宰、血腥、动物处理或厨房处理场景。输出高清真实摄影、4K 细节、自然光、专业产品摄影、真实阴影和高端电商视觉效果。`;
}

function extractGeneratedImages(data: ResponsesImageOutput): ImagePreviewPayload[] {
  const images: ImagePreviewPayload[] = [];

  for (const item of data.output ?? []) {
    if (item.type === "image_generation_call" && item.result) {
      images.push({
        name: `generated-${images.length + 1}.png`,
        url: `data:image/png;base64,${item.result}`,
      });
    }

    for (const content of item.content ?? []) {
      const url = content.image_url || content.url;
      const b64 = content.b64_json;
      if (url) {
        images.push({ name: `generated-${images.length + 1}.png`, url });
      }
      if (b64) {
        images.push({
          name: `generated-${images.length + 1}.png`,
          url: `data:image/png;base64,${b64}`,
        });
      }
    }
  }

  for (const item of data.data ?? []) {
    if (item.url) {
      images.push({ name: `generated-${images.length + 1}.png`, url: item.url });
    }
    if (item.b64_json) {
      images.push({
        name: `generated-${images.length + 1}.png`,
        url: `data:image/png;base64,${item.b64_json}`,
      });
    }
  }

  return images;
}

type FlattenedImage = Awaited<ReturnType<typeof flattenImages>>[number];

function buildImagesGenerationsRequest(settings: AiModelSettings, prompt: string, referenceImages: FlattenedImage[]) {
  return {
    url: `${settings.baseUrl}/images/generations`,
    body: {
      model: settings.model,
      prompt: buildImagePrompt(prompt),
      image_urls: referenceImages.slice(0, 14).map((image) => image.url),
      response_format: "b64_json",
      size: "1920x1920",
      n: 1,
      watermark: false,
    },
  };
}

function buildResponsesRequest(settings: AiModelSettings, prompt: string, referenceImages: FlattenedImage[]) {
  return {
    url: buildAiTextEndpoint(settings),
    body: {
      model: settings.model,
      tools: [{ type: "image_generation" }],
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildImagePrompt(prompt),
            },
            ...referenceImages.slice(0, 20).map((image) => ({
              type: "input_image",
              image_url: image.url,
            })),
          ],
        },
      ],
    },
  };
}

function buildAiHeaders(settings: AiModelSettings) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${settings.apiKey}`,
    "Content-Type": "application/json",
  };
  const isOpenRouter = settings.provider === "openrouter" || settings.baseUrl.includes("openrouter.ai");

  if (isOpenRouter) {
    headers["HTTP-Referer"] = process.env.OPENROUTER_HTTP_REFERER || "http://localhost:3000";
    headers["X-Title"] = process.env.OPENROUTER_APP_TITLE || "Amazon Bulk Ad Workspace";
  }

  return headers;
}

function getBase64ImagePayload(url: string) {
  const match = url.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);

  if (!match) {
    return undefined;
  }

  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function persistGeneratedImages(images: ImagePreviewPayload[], user: CurrentUser, scope: WorkspaceScopeInput) {
  const storage = getStorageDriver();

  return Promise.all(
    images.map(async (image) => {
      const payload = getBase64ImagePayload(image.url);

      if (!payload) {
        return image;
      }

      const key = createGeneratedAssetKey(image.name);
      const storedObject = await storage.putBuffer({
        key,
        buffer: payload.buffer,
        contentType: payload.contentType,
      });
      if (process.env.DATABASE_URL) {
        await prisma.fileObject.create({
          data: {
            organizationId: user.organizationId,
            userId: user.id,
            workspaceId: scope.workspaceId,
            accountId: scope.accountId,
            marketplace: scope.marketplace,
            originalName: image.name,
            mimeType: payload.contentType,
            size: storedObject.size,
            storageKey: storedObject.key,
            storageType: getStorageType(),
            status: "done",
          },
        });
      }

      return {
        ...image,
        url: createAssetUrl(storedObject.key),
        assetId: storedObject.key,
      };
    }),
  );
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("listingAi", "create");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as ImageGeneratorRequest;
    const scope = workspaceScopeFromRequest(request);
    const settings = resolveAiSettings(body.aiSettings, "image");
    const prompt = body.prompt?.trim();
    const referenceImages = await flattenImages(body, user);

    if (!settings.apiKey?.trim()) {
      return NextResponse.json(
        { error: "缺少 API Key，请先在 Settings 保存大模型配置。" },
        { status: 400 },
      );
    }

    if (!prompt) {
      return NextResponse.json({ error: "提示词不能为空。" }, { status: 400 });
    }

    if (!referenceImages.length) {
      return NextResponse.json(
        { error: "请至少上传一张六视图或竞品参考图。" },
        { status: 400 },
      );
    }

    if (settings.wireApi !== "responses" && settings.wireApi !== "image_generations") {
      return NextResponse.json(
        {
          error:
            "当前配置是 Chat Completions 文本/视觉接口，不能直接生成图片。请在 Settings 切换到支持 image_generation 的 Responses API 模型，或火山方舟 Images Generations API。",
        },
        { status: 400 },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      settings.timeoutSeconds * 1000,
    );
    let response: AiFetchResponse;

    try {
      const imageRequest =
        settings.wireApi === "image_generations"
          ? buildImagesGenerationsRequest(settings, prompt, referenceImages)
          : buildResponsesRequest(settings, prompt, referenceImages);

      response = await fetchAiApi(imageRequest.url, {
        method: "POST",
        signal: controller.signal,
        headers: buildAiHeaders(settings),
        body: JSON.stringify(imageRequest.body),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return NextResponse.json(
          { error: `图片生成请求超时：${settings.timeoutSeconds} 秒内没有返回。` },
          { status: 504 },
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      const endpointHint = errorText.includes("InvalidEndpointOrModel.NotFound")
        ? "。火山方舟提示模型或接入点不存在/无权限：请确认 Settings 里的模型 ID 是 doubao-seedream-5-0-lite-260128，或填写你在方舟控制台创建的推理接入点 Endpoint ID，并确认账号已开通该模型"
        : "";
      const sizeHint = errorText.includes("image size must be at least 3686400 pixels")
        ? "。Doubao-Seedream-5.0-lite 要求图片至少 3686400 像素，系统已按 1920x1920 请求；如仍报错请检查方舟模型尺寸限制是否有更新"
        : "";
      return NextResponse.json(
        {
          error: `图片生成失败：${response.status}${endpointHint}${sizeHint} ${errorText.slice(0, 500)}`,
        },
        { status: response.status },
      );
    }

    const data = (await response.json()) as ResponsesImageOutput | ImageGenerationsOutput;
    const images = await persistGeneratedImages(extractGeneratedImages(data), user, scope);

    if (!images.length) {
      return NextResponse.json(
        {
          error:
            "模型已返回，但没有找到图片结果。请确认模型支持 image_generation，并检查 Base URL/模型名称。",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ images });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "图片生成失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
