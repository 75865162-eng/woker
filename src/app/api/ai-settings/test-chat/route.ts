import { NextResponse } from "next/server";
import { normalizeAiSettings, type AiModelSettings } from "@/lib/ai-settings";
import { extractChatCompletionText, extractOutputText, type ResponsesApiOutput } from "@/lib/listing-ai/client";
import { fetchAiApi, type AiFetchResponse } from "@/lib/server/ai-fetch";

export const runtime = "nodejs";

interface TestChatRequest {
  message: string;
  aiSettings?: Partial<AiModelSettings>;
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TestChatRequest;
    const settings = normalizeAiSettings(body.aiSettings);
    const message = body.message?.trim() || "请用一句中文回复：模型配置连接成功。";

    if (!settings.apiKey?.trim()) {
      return NextResponse.json({ error: "缺少 API Key，请先保存大模型配置。" }, { status: 400 });
    }

    if (settings.wireApi === "image_generations") {
      return NextResponse.json(
        { error: "当前配置是图片生成接口，不能用于聊天测试。请在 Listing AI 的图片生成区验证火山方舟生图。" },
        { status: 400 },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), settings.timeoutSeconds * 1000);
    let response: AiFetchResponse;

    try {
      const isChatCompletions = settings.wireApi === "chat_completions";
      response = await fetchAiApi(`${settings.baseUrl}${isChatCompletions ? "/chat/completions" : "/v1/responses"}`, {
        method: "POST",
        signal: controller.signal,
        headers: buildAiHeaders(settings),
        body: JSON.stringify(
          isChatCompletions
            ? {
                model: settings.model,
                messages: [
                  {
                    role: "system",
                    content: "你是一个连接测试助手。只需简短回答用户问题，不要输出敏感信息。",
                  },
                  {
                    role: "user",
                    content: message,
                  },
                ],
              }
            : {
                model: settings.model,
                input: [
                  {
                    role: "system",
                    content: "你是一个连接测试助手。只需简短回答用户问题，不要输出敏感信息。",
                  },
                  {
                    role: "user",
                    content: message,
                  },
                ],
              },
        ),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return NextResponse.json({ error: `测试请求超时：${settings.timeoutSeconds} 秒内没有返回。` }, { status: 504 });
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
      return NextResponse.json({ error: `测试失败：${response.status} ${errorText.slice(0, 500)}` }, { status: response.status });
    }

    const data = await response.json();
    const text = settings.wireApi === "chat_completions" ? extractChatCompletionText(data as Parameters<typeof extractChatCompletionText>[0]) : extractOutputText(data as ResponsesApiOutput);

    if (!text) {
      return NextResponse.json({ error: "模型已响应，但没有返回可显示文本。" }, { status: 502 });
    }

    return NextResponse.json({
      result: {
        message: text,
        model: settings.model,
        baseUrl: settings.baseUrl,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "测试失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
