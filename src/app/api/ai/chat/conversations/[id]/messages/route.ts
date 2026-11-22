import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { resolveUserAiTextSettings } from "@/lib/server/user-ai-settings";
import { findSkill } from "@/lib/lili/catalog";
import {
  prepareUserMessage, createRun, finishRun, saveAssistantMessage,
  markMessageComplete, markOrphanPendingFailed, loadAnswer, ChatAccessError,
} from "@/lib/ai-chat/repository";
import { orchestrateAnswer, describeOrchestratorError } from "@/lib/ai-chat/orchestrator";
import { requireEnabledChatDataSources, type ChatDataProvider } from "@/lib/ai-chat/data-sources";
import { CHAT_LIMITS, type ChatAnswer, type ChatScope } from "@/lib/ai-chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const permission = await requireApiPermission("agents", "create", request);
  if (!permission.ok) return permission.response;
  const { user } = permission;
  const scopeInput = workspaceScopeFromRequest(request);
  const scope: ChatScope = { organizationId: user.organizationId, workspaceId: scopeInput.workspaceId, userId: user.id };
  const { id: conversationId } = await params;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content || content.length > CHAT_LIMITS.maxMessageChars) {
    return NextResponse.json({ error: `问题不能为空且不超过 ${CHAT_LIMITS.maxMessageChars} 字。` }, { status: 400 });
  }
  const clientKey = typeof body.clientKey === "string" && body.clientKey.length <= 200 ? body.clientKey : randomUUID();
  const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey.length <= 200 ? body.idempotencyKey : randomUUID();
  let skillSlug = typeof body.skillSlug === "string" && body.skillSlug.length <= 120 ? body.skillSlug : undefined;

  // 工作区/登录态守卫：每次工具调用前后复验当前请求用户与工作区未变化。
  const sessionGuard = async () => {
    const current = await getCurrentUserFromRequest(request);
    if (!current || current.id !== user.id || current.organizationId !== user.organizationId) {
      throw new Error("ERP 登录会话已失效，请重新登录。");
    }
  };

  try {
    // 数据源门禁：必须在用户显式确认启用至少一个可用 MCP 数据源后才允许调用数据。
    let enabledProviders: ChatDataProvider[];
    try {
      enabledProviders = await requireEnabledChatDataSources(scope);
    } catch (error) {
      const err = error as Error & { code?: string };
      if (err.code === "MCP_NOT_CONFIGURED") {
        return NextResponse.json({ error: err.message, code: "MCP_NOT_CONFIGURED" }, { status: 409, headers: { "Cache-Control": "no-store" } });
      }
      throw error;
    }

    // 技能：URL/表单的 slug 只用于查目录，不进入正文或授权判断。
    if (skillSlug && !findSkill(skillSlug)) skillSlug = undefined;

    const prepared = await prepareUserMessage(scope, conversationId, content, clientKey, idempotencyKey, skillSlug);
    if (prepared.duplicate) {
      return NextResponse.json({ answer: prepared.existing, duplicate: true }, { headers: { "Cache-Control": "no-store" } });
    }

    const run = await createRun(scope, conversationId, prepared.messageId, prepared.requestKey, skillSlug);
    const settings = await resolveUserAiTextSettings(user, { workspaceId: scope.workspaceId, accountId: "", marketplace: "" });

    let answer: ChatAnswer;
    try {
      answer = await orchestrateAnswer({ ...scope, question: content, skillSlug, settings, runId: run.id, sessionGuard, enabledProviders });
      await saveAssistantMessage(scope, conversationId, run.id, prepared.requestKey, answer);
      await markMessageComplete(scope, prepared.messageId);
      await finishRun(scope, run.id, {
        status: "COMPLETE", model: answer.model, skillSlug: answer.skill?.slug, skillHash: answer.skill?.hash,
        answerPreview: answer.text.slice(0, 500),
      });
      return NextResponse.json({ answer, duplicate: false }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof Error && error.message === "CANCELLED") {
        await markOrphanPendingFailed(scope, prepared.messageId);
        return NextResponse.json({ error: "已取消本次分析。", code: "CANCELLED" }, { status: 408 });
      }
      const described = describeOrchestratorError(error);
      await markOrphanPendingFailed(scope, prepared.messageId);
      await finishRun(scope, run.id, { status: "FAILED", errorCode: described.code, answerPreview: "" });
      return NextResponse.json({ error: described.message, code: described.code }, { status: 502 });
    }
  } catch (error) {
    if (error instanceof ChatAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "请求失败。" }, { status: 500 });
  }
}
