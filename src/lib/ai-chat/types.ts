/** AI 聊天的最小公共合同。所有结构化字段都在服务端生成，不信任浏览器。 */

export type ChatScope = {
  organizationId: string;
  workspaceId: string;
  userId: string;
};

export type ChatToolEvidence = {
  seq: number;
  provider: string;
  tool: string;
  argsSummary: string;
  resultSource?: string;
  resultHash?: string;
  rowCount?: number;
  status: "ok" | "error";
  errorCode?: string;
  durationMs: number;
  /** 展示用来源标签，例如 "erp/seller/site/2026-11-01..2026-11-07"。 */
  scopeLabel?: string;
};

export type ChatSkillRef = {
  slug: string;
  hash: string;
  name: string;
  summary: string;
  availability: "available" | "missing_body" | "forbidden" | "not_found";
};

export type ChatProviderStatus = {
  provider: string;
  status: "connected" | "not_connected" | "unavailable";
  toolCount: number;
  reason?: string;
};

export type ChatAnswer = {
  text: string;
  skill?: ChatSkillRef;
  tools: ChatToolEvidence[];
  providers: ChatProviderStatus[];
  /** 覆盖与缺口说明；无法核实的字段明确列为 unknown。 */
  coverage: string[];
  /** 被拒绝或未执行的动作（写、同步、付费），给出正确入口。 */
  skipped: string[];
  model: string;
  runId: string;
};

export type SendMessageInput = ChatScope & {
  conversationId: string;
  content: string;
  clientKey: string;
  skillSlug?: string;
  idempotencyKey: string;
};

export const CHAT_LIMITS = {
  maxMessageChars: 4000,
  maxTurns: 6,
  maxToolCalls: 6,
  maxModelCalls: 8,
  maxToolResultChars: 24000,
  maxContextChars: 120000,
  requestTimeoutMs: 180_000,
  maxConversations: 200,
  maxMessagesPerConversation: 400,
} as const;
