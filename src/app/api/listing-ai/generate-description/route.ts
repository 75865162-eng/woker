import { NextResponse } from "next/server";
import { type AiModelSettings } from "@/lib/ai-settings";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import {
  extractChatCompletionText,
  extractOutputText,
  type ResponsesApiOutput,
} from "@/lib/listing-ai/client";
import { fetchAiApi, type AiFetchResponse } from "@/lib/server/ai-fetch";
import { buildAiTextEndpoint, resolveAiSettings } from "@/lib/server/ai-runtime";
import { type TitleGeneratorMode } from "@/lib/listing-ai/workspace-draft";

export const runtime = "nodejs";

interface TitleField {
  key: string;
  label: string;
  weight: number;
  value: string;
}

interface DescriptionField {
  key: string;
  label: string;
  weight: number;
  value: string;
}

interface DescriptionGeneratorRequest {
  mode: TitleGeneratorMode;
  prompt: string;
  titleFields: TitleField[];
  descriptionFields: DescriptionField[];
  aiSettings?: Partial<AiModelSettings>;
}

function getModeLabel(mode: TitleGeneratorMode) {
  return mode === "new" ? "新品编写" : "老品优化";
}

function buildAiHeaders(settings: AiModelSettings) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${settings.apiKey}`,
    "Content-Type": "application/json",
  };
  const isOpenRouter =
    settings.provider === "openrouter" || settings.baseUrl.includes("openrouter.ai");

  if (isOpenRouter) {
    headers["HTTP-Referer"] = process.env.OPENROUTER_HTTP_REFERER || "http://localhost:3000";
    headers["X-Title"] = process.env.OPENROUTER_APP_TITLE || "Amazon Bulk Ad Workspace";
  }

  return headers;
}

function buildUserInput(
  mode: TitleGeneratorMode,
  titleFields: TitleField[],
  descriptionFields: DescriptionField[],
) {
  const sharedFields = titleFields.filter((field) =>
    ["productFeatures", "coreAdWords", "relatedKeywords", "adData"].includes(field.key),
  );
  const identityFields = titleFields.filter((field) =>
    ["productChineseName", "asin"].includes(field.key),
  );
  const weightLines = sharedFields
    .map((field) => `${field.label}: ${field.weight}%`)
    .join("\n");
  const identityLines = identityFields
    .map((field) => `${field.label}:\n${field.value.trim() || "空"}`)
    .join("\n\n");
  const sharedLines = sharedFields
    .map((field) => `${field.label}（权重 ${field.weight}%）:\n${field.value.trim() || "空"}`)
    .join("\n\n");
  const descriptionLines = descriptionFields
    .map((field) => `${field.label}（权重 ${field.weight}%）:\n${field.value.trim() || "空"}`)
    .join("\n\n");

  return `请严格按照系统提示词和以下页面输入生成五点描述。

【当前模式】
${getModeLabel(mode)}

【参考页面输入的权重优先级】
${weightLines || "无"}

【现有产品信息】
${identityLines || "空"}

【参考页面输入的资料】
${sharedLines || "空"}

【竞品描述参考】
${descriptionLines || "空"}`;
}

function parseDescriptionResults(text: string) {
  const lines = text
    .split(/\n+/)
    .map((line) =>
      line.replace(
        /^\s*(?:[1-5][.)、：:]|五点[1-5][：:]?|描述[1-5][：:]?)\s*/u,
        "",
      ).trim(),
    )
    .filter(Boolean);

  const numbered = lines.slice(0, 5);
  if (numbered.length >= 5) return numbered;

  const inlineMatches = Array.from(
    text.matchAll(/(?:^|\s)([1-5])[.)、：:]\s*([\s\S]*?)(?=\s[1-5][.)、：:]|$)/gu),
  )
    .map((match) => match[2]?.trim())
    .filter(Boolean)
    .slice(0, 5);

  return inlineMatches.length ? inlineMatches : numbered;
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("listingAi", "create");

    if (!permission.ok) {
      return permission.response;
    }

    const body = (await request.json()) as DescriptionGeneratorRequest;
    const settings = resolveAiSettings(body.aiSettings, "text");
    const prompt = body.prompt?.trim();
    const mode = body.mode === "new" ? "new" : "old";
    const titleFields = Array.isArray(body.titleFields) ? body.titleFields : [];
    const descriptionFields = Array.isArray(body.descriptionFields)
      ? body.descriptionFields
      : [];

    if (!settings.apiKey?.trim()) {
      return NextResponse.json({ error: "缺少 API Key，请先保存大模型配置。" }, { status: 400 });
    }

    if (!prompt) {
      return NextResponse.json({ error: "提示词不能为空。" }, { status: 400 });
    }

    if (
      !titleFields.some(
        (field) =>
          ["productFeatures", "coreAdWords", "relatedKeywords", "adData"].includes(field.key) &&
          field.value?.trim(),
      )
    ) {
      return NextResponse.json({ error: "请至少填写一项上方权重参考资料。" }, { status: 400 });
    }

    if (!descriptionFields.some((field) => field.value?.trim())) {
      return NextResponse.json({ error: "请至少填写一条竞品描述参考。" }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), settings.timeoutSeconds * 1000);
    let response: AiFetchResponse;

    try {
      const isChatCompletions = settings.wireApi === "chat_completions";
      response = await fetchAiApi(buildAiTextEndpoint(settings), {
        method: "POST",
        signal: controller.signal,
        headers: buildAiHeaders(settings),
        body: JSON.stringify(
          isChatCompletions
            ? {
                model: settings.model,
                messages: [
                  { role: "system", content: prompt },
                  { role: "user", content: buildUserInput(mode, titleFields, descriptionFields) },
                ],
              }
            : {
                model: settings.model,
                input: [
                  { role: "system", content: prompt },
                  { role: "user", content: buildUserInput(mode, titleFields, descriptionFields) },
                ],
              },
        ),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return NextResponse.json({ error: `五点描述生成请求超时：${settings.timeoutSeconds} 秒内没有返回。` }, { status: 504 });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes("only allows Codex official clients")) {
        return NextResponse.json({ error: "连接已到达 AIGOCODE，但这个 API Key 只允许 Codex 官方客户端使用，不能被当前本地 Web App 直接调用。请更换可用于 OpenAI 兼容 API 的 Key，或换成可直接调用的 Base URL。" }, { status: 403 });
      }
      return NextResponse.json({ error: `五点描述生成失败：${response.status} ${errorText.slice(0, 500)}` }, { status: response.status });
    }

    const data = await response.json();
    const text =
      settings.wireApi === "chat_completions"
        ? extractChatCompletionText(data as Parameters<typeof extractChatCompletionText>[0])
        : extractOutputText(data as ResponsesApiOutput);
    const results = parseDescriptionResults(text);

    if (results.length < 5) {
      return NextResponse.json({ error: "模型没有按要求返回 5 条五点描述，请点击提示词修改后强化输出格式。" }, { status: 502 });
    }

    return NextResponse.json({ results: results.slice(0, 5) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "五点描述生成失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
