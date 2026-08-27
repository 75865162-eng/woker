import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import {
  initialChatHistory,
  normalizeChatHistory,
  type ChatHistoryState,
} from "@/lib/listing-ai/chat-history";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

interface ChatHistoryPayload {
  history?: Partial<ChatHistoryState>;
}

function normalizePayload(value: unknown): ChatHistoryState {
  return normalizeChatHistory(
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<ChatHistoryState>)
      : null,
  );
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("listingAi", "view");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const scope = workspaceScopeFromRequest(request);
    const record = await prisma.listingAiChatHistory.findUnique({
      where: {
        organizationId_workspaceId_userId: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          userId: user.id,
        },
      },
    });

    return NextResponse.json({
      history: record
        ? normalizePayload({
            conversations: record.conversations,
            activeConversationId: record.activeConversationId,
          })
        : initialChatHistory,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load chat history.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const permission = await requireApiPermission("listingAi", "edit");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as ChatHistoryPayload;
    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);
    const history = normalizeChatHistory(body.history);

    await prisma.listingAiChatHistory.upsert({
      where: {
        organizationId_workspaceId_userId: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          userId: user.id,
        },
      },
      create: {
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        activeConversationId: history.activeConversationId,
        conversations: history.conversations as unknown as Prisma.InputJsonValue,
      },
      update: {
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        activeConversationId: history.activeConversationId,
        conversations: history.conversations as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ history });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save chat history.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
