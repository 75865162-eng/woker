import { prisma } from "@/lib/db/prisma";
import { randomUUID } from "node:crypto";
import type { ChatAnswer, ChatScope } from "./types";
import { CHAT_LIMITS } from "./types";

export class ChatAccessError extends Error {
  constructor(message: string, public status = 403) { super(message); }
}

/** 所有查询强制带三元组，杜绝跨租户/工作区/用户读取。 */
function scoped(scope: ChatScope) {
  return { organizationId: scope.organizationId, workspaceId: scope.workspaceId, userId: scope.userId };
}

export async function listConversations(scope: ChatScope) {
  return prisma.aiChatConversation.findMany({
    where: { ...scoped(scope), status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
    take: CHAT_LIMITS.maxConversations,
    select: { id: true, title: true, status: true, revision: true, updatedAt: true, createdAt: true },
  });
}

export async function createConversation(scope: ChatScope, title = "新对话") {
  return prisma.aiChatConversation.create({
    data: { ...scoped(scope), title: title.slice(0, 120) || "新对话" },
    select: { id: true, title: true, status: true, revision: true, updatedAt: true, createdAt: true },
  });
}

async function ownedConversation(scope: ChatScope, conversationId: string) {
  if (!conversationId || conversationId.length > 200) throw new ChatAccessError("会话无效。", 400);
  const conversation = await prisma.aiChatConversation.findFirst({ where: { ...scoped(scope), id: conversationId } });
  if (!conversation || conversation.status !== "ACTIVE") throw new ChatAccessError("会话不存在或无权访问。", 404);
  return conversation;
}

export async function getConversation(scope: ChatScope, conversationId: string) {
  const conversation = await ownedConversation(scope, conversationId);
  const messages = await prisma.aiChatMessage.findMany({
    where: { ...scoped(scope), conversationId, status: { not: "DELETED" } },
    orderBy: { createdAt: "asc" },
    take: CHAT_LIMITS.maxMessagesPerConversation,
    select: { id: true, role: true, content: true, skillSlug: true, skillHash: true, status: true, createdAt: true },
  });
  return { conversation: { id: conversation.id, title: conversation.title, revision: conversation.revision, updatedAt: conversation.updatedAt }, messages };
}

export async function renameConversation(scope: ChatScope, conversationId: string, title: string, expectedRevision: number) {
  const conversation = await ownedConversation(scope, conversationId);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== conversation.revision) throw new ChatAccessError("会话已变化，请刷新后重试。", 409);
  const clean = String(title ?? "").trim().slice(0, 120);
  if (!clean) throw new ChatAccessError("标题不能为空。", 400);
  const updated = await prisma.aiChatConversation.updateMany({
    where: { ...scoped(scope), id: conversationId, revision: expectedRevision },
    data: { title: clean, revision: { increment: 1 } },
  });
  if (updated.count !== 1) throw new ChatAccessError("会话已变化，请刷新后重试。", 409);
  return { id: conversationId, title: clean, revision: expectedRevision + 1 };
}

export async function deleteConversation(scope: ChatScope, conversationId: string) {
  await ownedConversation(scope, conversationId);
  const updated = await prisma.aiChatConversation.updateMany({
    where: { ...scoped(scope), id: conversationId },
    data: { status: "DELETED" },
  });
  if (updated.count !== 1) throw new ChatAccessError("会话不存在或无权访问。", 404);
  return { id: conversationId, deleted: true };
}

export type PreparedMessage = {
  messageId: string;
  requestKey: string;
  duplicate: boolean;
  existing?: ChatAnswer;
};

/** 幂等准备：同一会话 + clientKey 重复提交返回已存在结果，不重复调用模型/工具。 */
export async function prepareUserMessage(scope: ChatScope, conversationId: string, content: string, clientKey: string, idempotencyKey: string, skillSlug?: string, skillHash?: string): Promise<PreparedMessage> {
  await ownedConversation(scope, conversationId);
  const requestKey = `${scope.organizationId}:${scope.workspaceId}:${scope.userId}:${conversationId}:${idempotencyKey}`;
  const existingMsg = await prisma.aiChatMessage.findUnique({
    where: { conversationId_clientKey: { conversationId, clientKey } },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (existingMsg) {
    const run = existingMsg.runs[0];
    return { messageId: existingMsg.id, requestKey, duplicate: true, existing: run ? await loadAnswer(scope, run.id) : undefined };
  }
  const existingRun = await prisma.aiChatRun.findUnique({ where: { requestKey } });
  if (existingRun) return { messageId: "", requestKey, duplicate: true, existing: await loadAnswer(scope, existingRun.id) };

  const msg = await prisma.aiChatMessage.create({
    data: { ...scoped(scope), conversationId, role: "user", content, clientKey, skillSlug, skillHash, status: "PENDING" },
    select: { id: true },
  });
  return { messageId: msg.id, requestKey, duplicate: false };
}

export async function createRun(scope: ChatScope, conversationId: string, messageId: string, requestKey: string, skillSlug?: string, skillHash?: string) {
  return prisma.aiChatRun.create({
    data: { ...scoped(scope), conversationId, messageId, requestKey, status: "RUNNING", skillSlug, skillHash },
    select: { id: true, status: true },
  });
}

export async function markMessageComplete(scope: ChatScope, messageId: string) {
  await prisma.aiChatMessage.updateMany({ where: { ...scoped(scope), id: messageId }, data: { status: "COMPLETE" } });
}

export async function finishRun(scope: ChatScope, runId: string, result: { status: string; model?: string; skillSlug?: string; skillHash?: string; answerPreview: string; errorCode?: string }) {
  await prisma.aiChatRun.updateMany({
    where: { ...scoped(scope), id: runId },
    data: { ...result, finishedAt: new Date() },
  });
}

export async function recordToolCall(scope: ChatScope, data: {
  runId: string; seq: number; provider: string; tool: string; argsSummary: string;
  resultSource?: string; resultHash?: string; rowCount?: number; status: "ok" | "error";
  errorCode?: string; durationMs: number;
}) {
  await prisma.aiChatToolCall.create({ data: { ...scoped(scope), ...data } });
}

export async function getRunStatus(scope: ChatScope, runId: string) {
  return prisma.aiChatRun.findFirst({
    where: { ...scoped(scope), id: runId },
    select: { id: true, status: true, errorCode: true, answerPreview: true, finishedAt: true },
  });
}

/** 取消：仅 RUNNING 可转 CANCELLED；与完成并发时以数据库条件更新结果为准。 */
export async function cancelRun(scope: ChatScope, runId: string): Promise<"cancelled" | "already_finished" | "not_found"> {
  const updated = await prisma.aiChatRun.updateMany({
    where: { ...scoped(scope), id: runId, status: "RUNNING" },
    data: { status: "CANCELLED", errorCode: "CANCELLED", finishedAt: new Date() },
  });
  if (updated.count === 1) return "cancelled";
  const exists = await getRunStatus(scope, runId);
  return exists ? "already_finished" : "not_found";
}

export async function loadAnswer(scope: ChatScope, runId: string): Promise<ChatAnswer | undefined> {
  const run = await prisma.aiChatRun.findFirst({ where: { ...scoped(scope), id: runId }, include: { toolCalls: { orderBy: { seq: "asc" } } } });
  if (!run) return undefined;
  const assistant = await prisma.aiChatMessage.findFirst({ where: { ...scoped(scope), conversationId: run.conversationId, clientKey: assistantClientKey(run.requestKey) }, select: { content: true } });
  const answerText = run.status === "COMPLETE" ? (assistant?.content ?? run.answerPreview ?? "") : "";
  return {
    text: answerText,
    model: run.model ?? "",
    runId: run.id,
    skill: run.skillSlug ? { slug: run.skillSlug, hash: run.skillHash ?? "", name: run.skillSlug, summary: "", availability: "available" } : undefined,
    tools: run.toolCalls.map(tc => ({
      seq: tc.seq, provider: tc.provider, tool: tc.tool, argsSummary: tc.argsSummary,
      resultSource: tc.resultSource ?? undefined, resultHash: tc.resultHash ?? undefined,
      rowCount: tc.rowCount ?? undefined, status: tc.status as "ok" | "error",
      errorCode: tc.errorCode ?? undefined, durationMs: tc.durationMs,
    })),
    providers: [],
    coverage: [],
    skipped: [],
  };
}

export function assistantClientKey(requestKey: string) {
  return `assistant:${requestKey}`;
}

/** 幂等地保存助手回答消息；run 的 messageId 始终指向用户消息，不可改写。 */
export async function saveAssistantMessage(scope: ChatScope, conversationId: string, runId: string, requestKey: string, answer: ChatAnswer) {
  const clientKey = assistantClientKey(requestKey);
  const existing = await prisma.aiChatMessage.findUnique({
    where: { conversationId_clientKey: { conversationId, clientKey } },
  });
  if (existing) return existing.id;
  const msg = await prisma.aiChatMessage.create({
    data: {
      ...scoped(scope), conversationId, role: "assistant", content: answer.text,
      clientKey, skillSlug: answer.skill?.slug, skillHash: answer.skill?.hash, status: "COMPLETE",
    },
    select: { id: true },
  });
  await prisma.aiChatRun.updateMany({ where: { ...scoped(scope), id: runId }, data: { answerPreview: answer.text.slice(0, 500) } });
  return msg.id;
}

/** 孤儿清理：用户消息已建但 run 未成功落库时，标记为失败，避免永久 PENDING。 */
export async function markOrphanPendingFailed(scope: ChatScope, messageId: string) {
  await prisma.aiChatMessage.updateMany({ where: { ...scoped(scope), id: messageId, status: "PENDING" }, data: { status: "FAILED" } });
}

export { randomUUID };
