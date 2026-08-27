import { type AiModelSettings } from "@/lib/ai-settings";
import { fetchAiApi, type AiFetchResponse } from "@/lib/server/ai-fetch";
import { buildAiTextEndpoint, resolveAiSettings } from "@/lib/server/ai-runtime";
import { extractChatCompletionText, extractOutputText, type ResponsesApiOutput } from "@/lib/listing-ai/client";
import type { ImagePreviewPayload } from "@/lib/listing-ai/image-generation";

export interface ListingAiChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ListingAiChatRequest {
  prompt?: string;
  messages?: ListingAiChatMessage[];
  referenceImages?: ImagePreviewPayload[];
  aiSettings?: Partial<AiModelSettings>;
}

export interface ListingAiChatResult {
  reply: string;
  model: string;
  baseUrl: string;
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

export function buildListingAiChatSystemPrompt() {
  return [
    "你是 Listing AI 工作台的专业对话助手，负责帮助亚马逊运营做标题、五点、描述、图片创意和A+方案的创作与优化。",
    "回答要直接、清晰、可执行，优先使用中文。",
    "如果用户提供了文档内容，请结合文档信息给出建议，不要编造未提供的事实。",
    "如果用户要求图片创意、主图、副图或 A+ 视觉方案，请给出具体可执行的视觉方向、构图、文案与注意事项。",
  ].join("\n");
}

export async function generateListingAiChatReply(
  body: ListingAiChatRequest,
): Promise<ListingAiChatResult> {
  const settings = resolveAiSettings(body.aiSettings, "text");
  const prompt = body.prompt?.trim();
  const messages = (Array.isArray(body.messages) ? body.messages : []).filter(
    (message): message is ListingAiChatMessage =>
      Boolean(message && typeof message.content === "string" && message.content.trim()),
  );

  if (!settings.apiKey?.trim()) {
    throw new Error("缺少 API Key，请先在 Settings 保存大模型配置。");
  }

  if (settings.wireApi === "image_generations") {
    throw new Error("当前配置是图片生成接口，不能用于对话。请在 Settings 中切换到文本模型。");
  }

  if (!prompt && !messages.length) {
    throw new Error("请输入对话内容。");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.timeoutSeconds * 1000);
  let response: AiFetchResponse;

  const requestMessages = [
    { role: "system", content: buildListingAiChatSystemPrompt() },
    ...messages,
  ];
  const referenceImages = Array.isArray(body.referenceImages)
    ? body.referenceImages.filter((image) => image.url?.startsWith("data:image/"))
    : [];
  const lastMessage = messages.at(-1);
  const imagePrompt =
    prompt || (lastMessage?.role === "user" ? lastMessage.content : "") || "请识别并分析这张图片。";
  const requestMessagesWithoutImagePrompt =
    referenceImages.length && lastMessage?.role === "user"
      ? requestMessages.slice(0, -1)
      : requestMessages;
  if (prompt && !referenceImages.length) {
    requestMessages.push({ role: "user", content: prompt });
  }

  try {
    const isChatCompletions = settings.wireApi === "chat_completions";
    response = await fetchAiApi(
      buildAiTextEndpoint({
        baseUrl: settings.baseUrl,
        wireApi: isChatCompletions ? "chat_completions" : "responses",
      }),
      {
        method: "POST",
        signal: controller.signal,
        headers: buildAiHeaders(settings),
        body: JSON.stringify(
          isChatCompletions
            ? {
                model: settings.model,
                messages: referenceImages.length
                  ? [
                      ...requestMessagesWithoutImagePrompt,
                      {
                        role: "user",
                        content: [
                          { type: "text", text: imagePrompt },
                          ...referenceImages.slice(0, 8).map((image) => ({
                            type: "image_url",
                            image_url: { url: image.url },
                          })),
                        ],
                      },
                    ]
                  : requestMessages,
              }
            : {
                model: settings.model,
                input: referenceImages.length
                  ? [
                      ...requestMessagesWithoutImagePrompt,
                      {
                        role: "user",
                        content: [
                          { type: "input_text", text: imagePrompt },
                          ...referenceImages.slice(0, 8).map((image) => ({
                            type: "input_image",
                            image_url: image.url,
                          })),
                        ],
                      },
                    ]
                  : requestMessages,
              },
        ),
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`对话请求超时：${settings.timeoutSeconds} 秒内没有返回，请检查模型或网络。`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    if (errorText.includes("only allows Codex official clients")) {
      throw new Error(
        "连接已到达 AIGOCODE，但这个 API Key 只允许 Codex 官方客户端使用，不能被当前本地 Web App 直接调用。请更换可用于 OpenAI 兼容 API 的 Key，或换成可直接调用的 Base URL。",
      );
    }
    throw new Error(`对话请求失败：${response.status} ${errorText.slice(0, 500)}`);
  }

  const data = await response.json();
  const reply =
    settings.wireApi === "chat_completions"
      ? extractChatCompletionText(data as Parameters<typeof extractChatCompletionText>[0])
      : extractOutputText(data as ResponsesApiOutput);

  if (!reply) {
    throw new Error("模型没有返回可显示内容。");
  }

  return {
    reply,
    model: settings.model,
    baseUrl: settings.baseUrl,
  };
}
