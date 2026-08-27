import type { ChatAttachment } from "@/lib/listing-ai/chat-attachments";
import type { ImagePreview } from "@/lib/listing-ai/workspace-draft";

export type ChatMode = "text" | "image";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments?: ChatAttachment[];
  images?: ImagePreview[];
}

export interface ChatConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  mode: ChatMode;
}

export interface ChatHistoryState {
  conversations: ChatConversation[];
  activeConversationId: string;
}

export const initialChatHistory: ChatHistoryState = {
  conversations: [],
  activeConversationId: "",
};

export function normalizeChatHistory(value: Partial<ChatHistoryState> | null | undefined): ChatHistoryState {
  return {
    conversations: Array.isArray(value?.conversations)
      ? value.conversations.filter(
          (conversation): conversation is ChatConversation =>
            Boolean(
              conversation &&
                typeof conversation === "object" &&
                typeof conversation.id === "string" &&
                typeof conversation.title === "string" &&
                typeof conversation.createdAt === "string" &&
                typeof conversation.updatedAt === "string" &&
                Array.isArray(conversation.messages),
            ),
        )
      : [],
    activeConversationId:
      typeof value?.activeConversationId === "string" ? value.activeConversationId : "",
  };
}
