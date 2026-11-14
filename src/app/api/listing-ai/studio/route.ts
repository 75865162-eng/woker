import { NextResponse } from "next/server";
import { toPublicAiSettings, type AiModelSettings } from "@/lib/ai-settings";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { extractChatCompletionText, extractOutputText, type ResponsesApiOutput } from "@/lib/listing-ai/client";
import {
  buildStudioSystemPrompt,
  buildStudioUserPrompt,
  parseStudioResult,
  studioMarketplaces,
  studioTones,
  type StudioMarketplace,
  type StudioProductInput,
} from "@/lib/listing-ai/studio";
import { fetchAiApi, type AiFetchResponse } from "@/lib/server/ai-fetch";
import {
  buildAiRequestHeaders,
  buildAiTextEndpoint,
  buildResponsesRequestOptions,
  resolveAiSettings,
} from "@/lib/server/ai-runtime";
import { resolveUserAiImageSettings, resolveUserAiTextSettings } from "@/lib/server/user-ai-settings";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

type StudioRequestBody = Partial<StudioProductInput> & {
  aiSettings?: Partial<AiModelSettings>;
};

function text(value: unknown, maxLength = 4000) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function normalizeInput(body: StudioRequestBody): StudioProductInput {
  const marketplace = studioMarketplaces.includes(body.marketplace as StudioMarketplace)
    ? (body.marketplace as StudioMarketplace)
    : "US";
  const tone = studioTones.some((item) => item.id === body.tone)
    ? (body.tone as StudioProductInput["tone"])
    : "professional";

  return {
    marketplace,
    tone,
    chineseName: text(body.chineseName, 200),
    englishName: text(body.englishName, 200),
    brand: text(body.brand, 120),
    asin: text(body.asin, 40),
    productType: text(body.productType, 200),
    targetAudience: text(body.targetAudience, 600),
    useScenarios: text(body.useScenarios, 600),
    features: text(body.features),
    parameters: text(body.parameters),
    specifications: text(body.specifications),
    keywords: text(body.keywords, 1000),
    forbidden: text(body.forbidden, 1000),
    competitorNames: text(body.competitorNames, 600),
    competitorListing: text(body.competitorListing),
    imageNotes: text(body.imageNotes, 1000),
  };
}

function validateInput(input: StudioProductInput) {
  if (!input.chineseName && !input.englishName) {
    return "请至少填写中文名称或英文名称。";
  }

  if (!input.features.trim() && !input.parameters.trim() && !input.specifications.trim()) {
    return "产品特点、参数、规格至少填写一项，否则模型只能编造。";
  }

  return "";
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("listingAi", "view", request);

    if (!permission.ok) {
      return permission.response;
    }

    const scope = workspaceScopeFromRequest(request);
    const [textSettings, imageSettings] = await Promise.all([
      resolveUserAiTextSettings(permission.user, scope),
      resolveUserAiImageSettings(permission.user, scope),
    ]);

    return NextResponse.json({
      text: toPublicAiSettings(textSettings),
      image: toPublicAiSettings(imageSettings),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取 AI 配置失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("listingAi", "create", request);

    if (!permission.ok) {
      return permission.response;
    }

    const { user } = permission;
    const body = (await request.json()) as StudioRequestBody;
    const input = normalizeInput(body);
    const validationError = validateInput(input);

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const scope = workspaceScopeFromRequest(request);
    const savedSettings = await resolveUserAiTextSettings(user, scope);
    const settings = savedSettings.apiKey?.trim()
      ? savedSettings
      : resolveAiSettings(body.aiSettings, "text");

    if (!settings.apiKey?.trim()) {
      return NextResponse.json(
        { error: "系统里没有保存可用的文本模型配置，请先到「系统设置」保存 AI API。" },
        { status: 400 },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), settings.timeoutSeconds * 1000);
    const systemPrompt = buildStudioSystemPrompt();
    const userPrompt = buildStudioUserPrompt(input);
    let response: AiFetchResponse;

    try {
      const isChatCompletions = settings.wireApi === "chat_completions";
      response = await fetchAiApi(buildAiTextEndpoint(settings), {
        method: "POST",
        signal: controller.signal,
        headers: buildAiRequestHeaders(settings),
        body: JSON.stringify(
          isChatCompletions
            ? {
                model: settings.model,
                temperature: 0.4,
                response_format: { type: "json_object" },
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: userPrompt },
                ],
              }
            : {
                ...buildResponsesRequestOptions(settings),
                model: settings.model,
                input: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: userPrompt },
                ],
                text: { format: { type: "json_object" } },
              },
        ),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return NextResponse.json(
          { error: `生成请求超时：${settings.timeoutSeconds} 秒内没有返回。` },
          { status: 504 },
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();

      if (errorText.includes("only allows Codex official clients")) {
        return NextResponse.json(
          {
            error:
              "这个 API Key 只允许 Codex 官方客户端使用，不能被 Web App 直接调用。请在系统设置里换成可用的 OpenAI 兼容 Key。",
          },
          { status: 403 },
        );
      }

      return NextResponse.json(
        { error: `生成失败：${response.status} ${errorText.slice(0, 500)}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    const rawText =
      settings.wireApi === "chat_completions"
        ? extractChatCompletionText(data as Parameters<typeof extractChatCompletionText>[0])
        : extractOutputText(data as ResponsesApiOutput);

    if (!rawText.trim()) {
      return NextResponse.json({ error: "模型没有返回内容，请重试。" }, { status: 502 });
    }

    const result = parseStudioResult(rawText);

    return NextResponse.json({
      result,
      model: { provider: settings.provider, model: settings.model },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
