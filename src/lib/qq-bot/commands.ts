import { type QqBotCommand, type QqBotConversation, type QqBotMessageData } from "@/lib/qq-bot/types";

const COMMAND_PREFIXES = ["/code", "/status", "/diff", "/apply", "/cancel"];

function normalizeContent(content: string) {
  return content
    .replace(/<@![^>]+>/g, "")
    .replace(/<@[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveConversation(message: QqBotMessageData): QqBotConversation | undefined {
  if (message.group_openid) {
    return { kind: "group", openid: message.group_openid };
  }
  if (message.user_openid) {
    return { kind: "c2c", openid: message.user_openid };
  }
  if (message.channel_id) {
    return { kind: "channel", channelId: message.channel_id };
  }
  return undefined;
}

export function parseQqBotCommand(message: QqBotMessageData): QqBotCommand | null {
  const content = normalizeContent(message.content ?? "");
  if (!content) return null;

  const prefix = COMMAND_PREFIXES.find((candidate) => content === candidate || content.startsWith(`${candidate} `));
  const name = prefix ? prefix.slice(1) : "code";
  const args = prefix ? content.slice(prefix.length).trim() : content;

  if (!args && name === "code") return null;

  return {
    name,
    args,
    messageId: message.id,
    userId: message.author?.id ?? message.user_openid,
    sourceId: message.group_openid ?? message.channel_id ?? message.guild_id,
    conversation: resolveConversation(message),
  };
}
