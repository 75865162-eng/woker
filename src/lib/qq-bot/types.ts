export interface QqBotCallbackPayload {
  op?: number;
  t?: string;
  s?: number;
  id?: string;
  d?: unknown;
}

export interface QqBotValidationData {
  plain_token: string;
  event_ts: string;
}

export interface QqBotMessageData {
  id?: string;
  content?: string;
  author?: {
    id?: string;
    username?: string;
    user_openid?: string;
  };
  member?: {
    nick?: string;
  };
  channel_id?: string;
  guild_id?: string;
  group_openid?: string;
  user_openid?: string;
}

export type QqBotConversation =
  | {
      kind: "group";
      openid: string;
    }
  | {
      kind: "c2c";
      openid: string;
    }
  | {
      kind: "channel";
      channelId: string;
    };

export interface QqBotCommand {
  name: string;
  args: string;
  messageId?: string;
  userId?: string;
  sourceId?: string;
  conversation?: QqBotConversation;
}

export function isQqBotValidationData(value: unknown): value is QqBotValidationData {
  if (!value || typeof value !== "object") return false;
  const data = value as QqBotValidationData;
  return typeof data.plain_token === "string" && typeof data.event_ts === "string";
}

export function isQqBotMessageData(value: unknown): value is QqBotMessageData {
  if (!value || typeof value !== "object") return false;
  return typeof (value as QqBotMessageData).content === "string";
}
