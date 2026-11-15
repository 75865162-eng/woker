import { NextResponse } from "next/server";
import { type AiModelSettings } from "@/lib/ai-settings";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { extractChatCompletionText, extractOutputText, type ResponsesApiOutput } from "@/lib/listing-ai/client";
import {
  buildStudioRewriteSystemPrompt,
  buildStudioRewriteUserPrompt,
  studioMarketplaces,
  studioRewriteKindLabels,
  studioTones,
  type StudioMarketplace,
  type StudioProductInput,
  type StudioRewriteKind,
} from "@/lib/listing-ai/studio";
import { fetchAiApi, type AiFetchResponse } from "@/lib/server/ai-fetch";
import {
  buildAiRequestHeaders,
  buildAiTextEndpoint,
  buildResponsesRequestOptions,
  resolveAiSettings,
} from "@/lib/server/ai-runtime";
import { resolveUserAiTextSettings } from "@/lib/server/user-ai-settings";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const rewriteKinds = Object.keys(studioRewriteKindLabels) as StudioRewriteKind[];

type RewriteRequestBody = {
  kind?: StudioRewriteKind;
  text?: string;
  instruction?: string;
  context?: Partial<StudioProductInput>;
  aiSettings?: Partial<AiModelSettings>;
};

function text(value: unknown, maxLength = 4000) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function normalizeContext(value: Partial<StudioProductInput> | undefined): StudioProductInput {
  const marketplace = studioMarketplaces.includes(value?.marketplace as StudioMarketplace)
    ? (value?.marketplace as StudioMarketplace)
    : "US";
  const tone = studioTones.some((item) => item.id === value?.tone)
    ? (value?.tone as StudioProductInput["tone"])
    : "professional";

  return {
    marketplace,
    tone,
    chineseName: text(value?.chineseName, 200),
    englishName: text(value?.englishName, 200),
    brand: text(value?.brand, 120),
    asin: text(value?.asin, 40),
    productType: text(value?.productType, 200),
    targetAudience: text(value?.targetAudience, 600),
    useScenarios: text(value?.useScenarios, 600),
    features: text(value?.features),
    parameters: text(value?.parameters),
    specifications: text(value?.specifications),
    keywords: text(value?.keywords, 1000),
    forbidden: text(value?.forbidden, 1000),
    competitorNames: text(value?.competitorNames, 600),
    competitorListing: text(value?.competitorListing),
    imageNotes: text(value?.imageNotes, 1000),
  };
}

function cleanRewriteOutput(value: string) {
  return value
    .trim()
    .replace(/^```(?:[a-z]+)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^["“]([\s\S]*)["”]$/, "$1")
    .trim();
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("listingAi", "create", request);

    if (!permission.ok) {
      return permission.response;
    }

    const body = (await request.json()) as RewriteRequestBody;
    const kind = rewriteKinds.includes(body.kind as StudioRewriteKind)
      ? (body.kind as StudioRewriteKind)
      : null;
    const source = text(body.text, 6000);

    if (!kind) {
      return NextResponse.json({ error: "不支持的改写类型。" }, { status: 400 });
    }

    if (!source.trim()) {
      return NextResponse.json({ error: "没有可改写的内容。" }, { status: 400 });
    }

    const scope = workspaceScopeFromRequest(request);
    const savedSettings = await resolveUserAiTextSettings(permission.user, scope);
    const settings = savedSettings.apiKey?.trim()
      ? savedSettings
      : resolveAiSettings(body.aiSettings, "text");

    if (!settings.apiKey?.trim()) {
      return NextResponse.json(
        { error: "系统里没有保存可用的文本模型配置，请先到「系统设置」保存 AI API。" },
        { status: 400 },
      );
    }

    const context = normalizeContext(body.context);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), settings.timeoutSeconds * 1000);
    const systemPrompt = buildStudioRewriteSystemPrompt();
    const userPrompt = buildStudioRewriteUserPrompt({
      kind,
      text: source,
      instruction: text(body.instruction, 400),
      input: context,
    });
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
                temperature: 0.5,
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
              },
        ),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return NextResponse.json(
          { error: `改写请求超时：${settings.timeoutSeconds} 秒内没有返回。` },
          { status: 504 },
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `改写失败：${response.status} ${errorText.slice(0, 400)}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    const rawText =
      settings.wireApi === "chat_completions"
        ? extractChatCompletionText(data as Parameters<typeof extractChatCompletionText>[0])
        : extractOutputText(data as ResponsesApiOutput);
    const clean = cleanRewriteOutput(rawText);

    if (!clean) {
      return NextResponse.json({ error: "模型没有返回改写内容，请重试。" }, { status: 502 });
    }

    return NextResponse.json({
      text: clean,
      model: { provider: settings.provider, model: settings.model },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "改写失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
