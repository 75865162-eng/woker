import { buildListingOptimizationPrompt } from "./prompt";
import { type AiModelSettings } from "@/lib/ai-settings";
import { fetchAiApi, type AiFetchResponse } from "@/lib/server/ai-fetch";
import { buildAiTextEndpoint, resolveAiSettings } from "@/lib/server/ai-runtime";
import type { ListingOptimizationRequest, ListingOptimizationResult } from "./types";

export interface ResponsesApiOutput {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
}

interface ChatCompletionsApiOutput {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export function extractOutputText(data: ResponsesApiOutput) {
  if (data.output_text) return data.output_text;

  const chunks = data.output?.flatMap((item) => item.content ?? []).map((item) => item.text).filter(Boolean) ?? [];
  return chunks.join("\n");
}

export function extractChatCompletionText(data: ChatCompletionsApiOutput) {
  return data.choices?.map((choice) => choice.message?.content).filter(Boolean).join("\n") ?? "";
}

function buildAiHeaders(settings: {
  apiKey: string;
  baseUrl: string;
  provider?: AiModelSettings["provider"];
}) {
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

function parseJsonResult(text: string): ListingOptimizationResult {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI 返回内容不是可解析的 JSON。");
  }

  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as ListingOptimizationResult;

  return {
    score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
    title: parsed.title || "",
    positioning: parsed.positioning || {
      oneSentence: "",
      strongestSellingPoint: "",
      buyerReason: "",
      competitorOpportunity: "",
    },
    aiAnalysis: parsed.aiAnalysis || {
      position: "",
      strength: [],
      weakness: [],
      opportunity: [],
      risk: [],
    },
    titleOptions: Array.isArray(parsed.titleOptions) ? parsed.titleOptions : [],
    bullets: Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, 5) : [],
    description: parsed.description || "",
    backendSearchTerms: parsed.backendSearchTerms || "",
    keywordCoverage: Array.isArray(parsed.keywordCoverage) ? parsed.keywordCoverage : [],
    imagePlan: Array.isArray(parsed.imagePlan) ? parsed.imagePlan : [],
    aplusPlan: Array.isArray(parsed.aplusPlan) ? parsed.aplusPlan : [],
    designerChecklist: Array.isArray(parsed.designerChecklist) ? parsed.designerChecklist : [],
    aiReview: parsed.aiReview || {
      listingScore: 0,
      imageScore: 0,
      aplusScore: 0,
      keywordScore: 0,
      buyerDesireScore: 0,
      verdict: "",
      mustFix: [],
      regenerationAdvice: [],
    },
    complianceNotes: Array.isArray(parsed.complianceNotes) ? parsed.complianceNotes : [],
    nextActions: Array.isArray(parsed.nextActions) ? parsed.nextActions : [],
  };
}

export async function optimizeListing(input: ListingOptimizationRequest, aiSettings?: Partial<AiModelSettings>) {
  const requestSettings = resolveAiSettings(aiSettings, "text");
  const apiKey = requestSettings.apiKey;
  const baseUrl = requestSettings.baseUrl;
  const model = requestSettings.model;
  const timeoutSeconds = requestSettings.timeoutSeconds;
  const provider = requestSettings.provider;

  if (!apiKey) {
    throw new Error("缺少 AI API Key。请先在 Settings 页面保存大模型配置。");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  let response: AiFetchResponse;

  try {
    const isChatCompletions = requestSettings?.wireApi === "chat_completions";
    response = await fetchAiApi(buildAiTextEndpoint({ baseUrl, wireApi: isChatCompletions ? "chat_completions" : "responses" }), {
      method: "POST",
      signal: controller.signal,
      headers: {
        ...buildAiHeaders({ apiKey, baseUrl, provider }),
      },
      body: JSON.stringify(
        isChatCompletions
          ? {
              model,
              messages: [
                {
                  role: "user",
                  content: buildListingOptimizationPrompt(input),
                },
              ],
              response_format: { type: "json_object" },
            }
          : {
              model,
              input: buildListingOptimizationPrompt(input),
              text: {
                format: { type: "json_object" },
              },
            },
      ),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`AI 请求超时：${timeoutSeconds} 秒内没有返回，请检查模型或网络。`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    if (errorText.includes("only allows Codex official clients")) {
      throw new Error("连接已到达 AIGOCODE，但这个 API Key 只允许 Codex 官方客户端使用，不能被当前本地 Web App 直接调用。请更换可用于 OpenAI 兼容 API 的 Key，或换成可直接调用的 Base URL。");
    }
    throw new Error(`AI 请求失败：${response.status} ${errorText.slice(0, 500)}`);
  }

  const data = await response.json();
  const text = requestSettings?.wireApi === "chat_completions" ? extractChatCompletionText(data as ChatCompletionsApiOutput) : extractOutputText(data as ResponsesApiOutput);

  if (!text) {
    throw new Error("AI 没有返回可用内容。");
  }

  return parseJsonResult(text);
}
