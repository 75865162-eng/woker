"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  FileText,
  History,
  ImagePlus,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Send,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChatConversation,
  type ChatHistoryState,
  type ChatMessage,
  initialChatHistory,
  normalizeChatHistory,
} from "@/lib/listing-ai/chat-history";
import { fieldClass } from "@/lib/listing-ai/workspace-draft";
import { createChatAttachment, type ChatAttachment } from "@/lib/listing-ai/chat-attachments";
import type { ImagePreview } from "@/lib/listing-ai/workspace-draft";
import { createBrowserId } from "@/lib/browser/random-id";
const legacyConversationStorageKey = "listing-ai-chat-conversations-v1";
const legacyActiveConversationStorageKey = "listing-ai-chat-active-v1";
const chatHistoryEndpoint = "/api/listing-ai/chat-history";
const chatRequestTimeoutMs = 245_000;
const defaultImagePrompt =
  "请根据上传的参考图片生成一张优化后的 Amazon Listing 商品图片，保持产品主体清晰，优化构图、卖点表达和电商视觉质感。";
const defaultImageQuestionPrompt = "请识别并分析这张图片，说明图中产品、主要元素和可优化方向。";
const imageGenerationIntentPattern =
  /(生成|生图|出图|画一张|做一张|设计一张|重绘|改图|修图|换背景|去背景|抠图|添加背景|生成图片|生成主图|生成副图|generate|create|render|redraw|make an image)/i;

function formatTime(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function truncate(value: string, maxLength = 28) {
  const normalized = value.trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}…`;
}

function resolveChatMode(prompt: string, attachments: ChatAttachment[]) {
  const hasImage = attachments.some((item) => item.kind === "image");

  if (!hasImage) {
    return "text";
  }

  return !prompt.trim() || imageGenerationIntentPattern.test(prompt) ? "image" : "text";
}

function buildConversationTitle(prompt: string, attachments: ChatAttachment[], mode: "text" | "image") {
  const firstImage = attachments.find((item) => item.kind === "image");
  const firstDocument = attachments.find((item) => item.kind === "document");
  if (firstImage) {
    return `${mode === "image" ? "图片生成" : "图片对话"} · ${truncate(prompt || firstImage.name) || "新对话"}`;
  }
  if (firstDocument) {
    return `文档对话 · ${truncate(prompt || firstDocument.name) || "新对话"}`;
  }

  return truncate(prompt, 20) || "新对话";
}

function buildPromptText(prompt: string, attachments: ChatAttachment[], mode: "text" | "image") {
  const hasImage = attachments.some((item) => item.kind === "image");
  const documentBlocks = attachments
    .filter((item) => item.kind === "document")
    .map((item) => `【${item.name}】\n${item.summary || "无摘要"}`)
    .join("\n\n");

  const fallbackPrompt = hasImage
    ? mode === "image"
      ? defaultImagePrompt
      : defaultImageQuestionPrompt
    : "";

  return [prompt.trim() || fallbackPrompt, documentBlocks]
    .filter(Boolean)
    .join("\n\n");
}

function readLegacyChatHistory(): ChatHistoryState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const savedConversations = window.localStorage.getItem(legacyConversationStorageKey);
    if (!savedConversations) {
      return null;
    }

    const conversations = JSON.parse(savedConversations) as ChatConversation[];
    const activeConversationId = window.localStorage.getItem(legacyActiveConversationStorageKey) ?? "";

    return normalizeChatHistory({
      conversations,
      activeConversationId,
    });
  } catch {
    return null;
  }
}

function ChatAttachmentStrip({
  attachments,
  onRemove,
}: {
  attachments: ChatAttachment[];
  onRemove: (id: string) => void;
}) {
  if (!attachments.length) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="flex max-w-[260px] items-start gap-2 rounded-md border border-border bg-surface-muted px-2 py-1.5"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-foreground">{attachment.name}</p>
            <p className="mt-0.5 text-[11px] text-muted">
              {attachment.kind === "image" ? "图片附件" : "文档附件"}
            </p>
          </div>
          <button
            type="button"
            className="mt-0.5 text-muted hover:text-foreground"
            onClick={() => onRemove(attachment.id)}
            title="移除附件"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function AttachmentPreview({
  attachment,
  compact = false,
}: {
  attachment: ChatAttachment;
  compact?: boolean;
}) {
  if (attachment.kind === "image") {
    return (
      <div className={`overflow-hidden rounded-md border border-border bg-white ${compact ? "w-20" : "w-28"}`}>
        <div className={`${compact ? "h-20" : "h-28"} bg-white`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={attachment.url} alt={attachment.name} className="h-full w-full object-contain p-1" />
        </div>
        <div className="truncate border-t border-border px-2 py-1 text-[10px] font-semibold text-muted">
          {attachment.name}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-white px-3 py-2 text-xs">
      <div className="flex items-center gap-2 font-semibold text-foreground">
        <FileText className="h-3.5 w-3.5 text-brand" />
        <span className="truncate">{attachment.name}</span>
      </div>
      <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-muted thin-scrollbar">
        {attachment.summary || "无摘要"}
      </pre>
    </div>
  );
}

export function ListingAiChatPanel() {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [forceImageGeneration, setForceImageGeneration] = useState(false);
  const fileInputId = useId();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const response = await fetch(chatHistoryEndpoint);
        const data = (await response.json()) as {
          history?: Partial<ChatHistoryState> | null;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error || "读取聊天记录失败。");
        }

        const nextHistory = normalizeChatHistory(data.history);
        if (!cancelled) {
          setConversations(nextHistory.conversations);
          setActiveConversationId(nextHistory.activeConversationId || nextHistory.conversations[0]?.id || "");
          setHydrated(true);
        }

        if (!nextHistory.conversations.length) {
          const legacyHistory = readLegacyChatHistory();
          if (legacyHistory && !cancelled) {
            setConversations(legacyHistory.conversations);
            setActiveConversationId(
              legacyHistory.activeConversationId || legacyHistory.conversations[0]?.id || "",
            );
          }
        }
      } catch (historyError) {
        console.warn("Failed to load Listing AI chat history.", historyError);
        const legacyHistory = readLegacyChatHistory();
        if (!cancelled) {
          setConversations(legacyHistory?.conversations ?? initialChatHistory.conversations);
          setActiveConversationId(
            legacyHistory?.activeConversationId || legacyHistory?.conversations[0]?.id || "",
          );
          setHydrated(true);
        }
      }
    }

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void fetch(chatHistoryEndpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history: {
            conversations,
            activeConversationId,
          },
        }),
      }).then(async (response) => {
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          console.warn(data.error || "Failed to persist Listing AI chat history.");
        }
      });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [activeConversationId, conversations, hydrated]);

  useEffect(() => {
    const container = messagesScrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [activeConversationId, conversations]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

  const activeMessages = activeConversation?.messages ?? [];
  const hasImageAttachment = attachments.some((attachment) => attachment.kind === "image");
  const effectiveMode = forceImageGeneration && hasImageAttachment
    ? "image"
    : resolveChatMode(input, attachments);
  const effectiveModeLabel = effectiveMode === "image" ? "图片生成" : hasImageAttachment ? "图片问答" : "文本对话";

  function upsertConversation(nextConversation: ChatConversation) {
    setConversations((current) => {
      const next = [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)];
      return next.slice(0, 12);
    });
    setActiveConversationId(nextConversation.id);
  }

  function startNewConversation() {
    const now = new Date().toISOString();
    const nextConversation: ChatConversation = {
      id: createBrowserId(),
      title: "新对话",
      createdAt: now,
      updatedAt: now,
      messages: [],
      mode: "text",
    };

    upsertConversation(nextConversation);
    setInput("");
    setAttachments([]);
    setError("");
    setForceImageGeneration(false);
  }

  async function handleFilePick(files: FileList | null) {
    const selected = Array.from(files ?? []).slice(0, 8);

    if (!selected.length) {
      return;
    }

    setError("");

    try {
      const nextAttachments = await Promise.all(selected.map((file) => createChatAttachment(file)));
      setAttachments((current) => {
        return [...current, ...nextAttachments].slice(0, 8);
      });
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "附件处理失败。");
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const next = current.filter((item) => item.id !== id);
      if (!next.some((item) => item.kind === "image")) {
        setForceImageGeneration(false);
      }
      return next;
    });
  }

  function editMessage(message: ChatMessage) {
    if (message.role !== "user") {
      return;
    }

    setInput(message.input ?? message.content);
    setAttachments(message.attachments ?? []);
    setError("");
    setForceImageGeneration(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function sendMessage() {
    const prompt = input.trim();
    if (!prompt && !attachments.length) {
      return;
    }

    setLoading(true);
    setError("");

    const requestMode = forceImageGeneration && attachments.some((attachment) => attachment.kind === "image")
      ? "image"
      : resolveChatMode(prompt, attachments);
    const nextConversationId = activeConversation?.id ?? createBrowserId();
    const now = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: createBrowserId(),
      role: "user",
      content: buildPromptText(prompt, attachments, requestMode),
      input: prompt,
      createdAt: now,
      attachments,
    };
    const baseConversation: ChatConversation = activeConversation ?? {
      id: nextConversationId,
      title: buildConversationTitle(prompt, attachments, requestMode),
      createdAt: now,
      updatedAt: now,
      messages: [],
      mode: requestMode,
    };
    const nextConversation: ChatConversation = {
      ...baseConversation,
      title: baseConversation.messages.length ? baseConversation.title : buildConversationTitle(prompt, attachments, requestMode),
      updatedAt: now,
      mode: requestMode,
      messages: [...baseConversation.messages, userMessage],
    };

    upsertConversation(nextConversation);
    setInput("");
    setAttachments([]);
    setForceImageGeneration(false);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), chatRequestTimeoutMs);

    try {
      const response = await fetch("/api/listing-ai/chat", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: requestMode,
          prompt: requestMode === "image" ? userMessage.content : undefined,
          messages: nextConversation.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          referenceImages: attachments
            .filter((attachment) => attachment.kind === "image")
            .map((attachment) => ({
              name: attachment.name,
              url: attachment.url,
              assetId: attachment.assetId,
            })),
        }),
      });
      const data = (await response.json()) as {
        reply?: string;
        images?: ImagePreview[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "对话发送失败。");
      }

      const assistantMessage: ChatMessage = {
        id: createBrowserId(),
        role: "assistant",
        content:
          requestMode === "image"
            ? data.images?.length
              ? `已生成 ${data.images.length} 张图片。`
              : data.reply || "图片结果已返回。"
            : data.reply || "",
        createdAt: new Date().toISOString(),
        images: data.images,
      };

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === nextConversation.id
            ? {
                ...conversation,
                updatedAt: assistantMessage.createdAt,
                messages: [...conversation.messages, assistantMessage],
              }
            : conversation,
        ),
      );
    } catch (sendError) {
      const isAbortError = sendError instanceof Error && sendError.name === "AbortError";
      const message = isAbortError
        ? "请求超时：模型接口长时间没有返回，请检查 Settings 里的模型配置后重试。"
        : sendError instanceof Error
          ? sendError.message
          : "对话发送失败。";
      const assistantMessage: ChatMessage = {
        id: createBrowserId(),
        role: "assistant",
        content: requestMode === "image" ? `图片生成失败：${message}` : `对话失败：${message}`,
        createdAt: new Date().toISOString(),
      };

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === nextConversation.id
            ? {
                ...conversation,
                updatedAt: assistantMessage.createdAt,
                messages: [...conversation.messages, assistantMessage],
              }
            : conversation,
        ),
      );
      setError(message);
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  function selectConversation(conversationId: string) {
    setActiveConversationId(conversationId);
    setError("");
    setAttachments([]);
    setInput("");
  }

  function deleteConversation(conversationId: string) {
    setConversations((current) => {
      const next = current.filter((conversation) => conversation.id !== conversationId);
      if (activeConversationId === conversationId) {
        setActiveConversationId(next[0]?.id ?? "");
      }
      return next;
    });
  }

  return (
    <Card className="xl:sticky xl:top-4">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>对话</CardTitle>
            <p className="mt-1 text-xs font-semibold text-muted">
              上传图片后可识别分析；明确提出生成、重绘或换背景时才会生图。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={effectiveMode === "image" ? "amber" : "blue"}>
              {effectiveModeLabel}
            </Badge>
            <Button variant="secondary" size="icon" onClick={startNewConversation} title="新对话">
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-3">
        <div className="grid gap-3 xl:grid-cols-[168px_minmax(0,1fr)]">
          <div className="rounded-md border border-border bg-surface-muted/40 p-2">
            <div className="mb-2 flex items-center gap-2 px-1 text-xs font-bold text-muted">
              <History className="h-3.5 w-3.5" />
              最近对话
            </div>
            <div className="thin-scrollbar max-h-[520px] space-y-1 overflow-auto pr-1">
              {conversations.length ? (
                conversations.map((conversation) => {
                  const active = conversation.id === activeConversationId;
                  const lastMessage = conversation.messages.at(-1);
                  return (
                    <div
                      key={conversation.id}
                      className={`w-full rounded-md border px-2 py-2 text-left transition ${
                        active
                          ? "border-brand bg-brand/5"
                          : "border-border bg-white hover:bg-surface-muted"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => selectConversation(conversation.id)}
                        >
                          <p className="truncate text-xs font-bold text-foreground">
                            {conversation.title}
                          </p>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted">
                            {lastMessage?.content || "尚未开始"}
                          </p>
                        </button>
                        <button
                          type="button"
                          className="text-muted hover:text-foreground"
                          onClick={() => deleteConversation(conversation.id)}
                          title="删除对话"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                      <Badge tone={conversation.mode === "image" ? "amber" : "blue"} className="text-[10px]">
                          {conversation.mode === "image" ? "图片" : "文本"}
                        </Badge>
                        <span className="text-[10px] text-muted">{formatTime(conversation.updatedAt)}</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-md border border-dashed border-border bg-white px-3 py-6 text-center text-xs font-semibold text-muted">
                  暂无对话
                </div>
              )}
            </div>
          </div>

          <div className="min-w-0 rounded-md border border-border bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">
                  {activeConversation?.title || "对话区"}
                </p>
                <p className="text-xs text-muted">
                  {activeConversation ? `${activeConversation.messages.length} 条消息` : "选择左侧对话或新建一个开始"}
                </p>
              </div>
              <Badge tone={effectiveMode === "image" ? "amber" : "blue"}>
                {effectiveModeLabel}
              </Badge>
            </div>

            <div
              ref={messagesScrollRef}
              className="thin-scrollbar max-h-[520px] space-y-3 overflow-auto p-3"
            >
              {activeMessages.length ? (
                activeMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[92%] rounded-md px-3 py-2 text-sm leading-6 ${
                        message.role === "user"
                          ? "bg-brand text-white"
                          : "border border-border bg-surface-muted text-foreground"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{message.content || " "}</p>

                      {message.attachments?.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {message.attachments.map((attachment) => (
                            <AttachmentPreview key={attachment.id} attachment={attachment} compact />
                          ))}
                        </div>
                      ) : null}

                      {message.images?.length ? (
                        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
                          {message.images.map((image) => (
                            <button
                              key={`${image.name}-${image.url.slice(0, 20)}`}
                              type="button"
                              className="overflow-hidden rounded-md border border-border bg-white text-left"
                            >
                              <div className="h-28 bg-white">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={image.url}
                                  alt={image.name}
                                  className="h-full w-full object-contain p-1"
                                />
                              </div>
                              <div className="truncate border-t border-border px-2 py-1 text-[11px] font-semibold text-muted">
                                {image.name}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold opacity-70">
                          {formatTime(message.createdAt)}
                        </p>
                        {message.role === "user" ? (
                          <button
                            type="button"
                            className="rounded p-1 opacity-70 transition hover:bg-white/15 hover:opacity-100"
                            onClick={() => editMessage(message)}
                            title="编辑后重新发送"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex min-h-[420px] items-center justify-center rounded-md border border-dashed border-border bg-surface-muted/30 px-6 text-center">
                  <div>
                    <Sparkles className="mx-auto h-8 w-8 text-muted" />
                    <p className="mt-3 text-sm font-bold text-foreground">开始一个 Listing 对话</p>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      可直接聊标题、文案、A+；上传图片可问答分析，明确要求生成时才会出图。
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3 border-t border-border p-3">
              {attachments.length ? (
                <ChatAttachmentStrip attachments={attachments} onRemove={removeAttachment} />
              ) : null}

              {error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  {error}
                </div>
              ) : null}

              <div className="space-y-2">
                <textarea
                  ref={inputRef}
                  className={`${fieldClass} min-h-24 resize-y py-2`}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="输入问题、文档说明或图片生成需求"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <label
                      className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-xs font-semibold text-foreground transition-colors hover:bg-surface-muted"
                      htmlFor={fileInputId}
                    >
                      <Upload className="h-4 w-4" />
                      添加附件
                    </label>
                    <Button
                      variant={forceImageGeneration ? "primary" : "secondary"}
                      size="sm"
                      disabled={!hasImageAttachment}
                      onClick={() => setForceImageGeneration((current) => !current)}
                      title="强制使用生图 API"
                    >
                      <ImagePlus className="h-4 w-4" />
                      生图
                    </Button>
                    <input
                      id={fileInputId}
                      className="sr-only"
                      type="file"
                      multiple
                      accept="image/*,.pdf,.xls,.xlsx,.csv,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      onChange={(event) => {
                        void handleFilePick(event.target.files);
                        event.currentTarget.value = "";
                      }}
                    />
                    <Badge tone={effectiveMode === "image" ? "amber" : "blue"}>
                      {effectiveMode === "image"
                        ? "图片附件 -> 图片生成"
                        : hasImageAttachment
                          ? "图片附件 -> 图片问答"
                          : "文档附件 -> 系统"}
                    </Badge>
                  </div>

                  <Button disabled={loading || (!input.trim() && !attachments.length)} onClick={sendMessage}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {loading ? "发送中" : "发送"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
