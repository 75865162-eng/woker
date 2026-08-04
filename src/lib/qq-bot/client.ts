import { type QqBotConfig } from "@/lib/qq-bot/config";
import { type QqBotConversation } from "@/lib/qq-bot/types";

interface QqBotAccessToken {
  access_token?: string;
  expires_in?: number;
}

let cachedAccessToken: { token: string; expiresAt: number } | undefined;

async function getAccessToken(config: QqBotConfig) {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60_000) {
    return cachedAccessToken.token;
  }

  const response = await fetch(`${config.apiBaseUrl}/app/getAppAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appId: config.appId,
      clientSecret: config.secret,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as QqBotAccessToken;

  if (!response.ok || !data.access_token) {
    throw new Error(`QQ Bot access token 获取失败：${response.status}`);
  }

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: now + Math.max(60, data.expires_in ?? 600) * 1000,
  };
  return cachedAccessToken.token;
}

function messageUrl(config: QqBotConfig, conversation: QqBotConversation) {
  if (conversation.kind === "group") {
    return `${config.apiBaseUrl}/v2/groups/${conversation.openid}/messages`;
  }
  if (conversation.kind === "c2c") {
    return `${config.apiBaseUrl}/v2/users/${conversation.openid}/messages`;
  }
  return `${config.apiBaseUrl}/channels/${conversation.channelId}/messages`;
}

function buildMessageBody(content: string, messageId?: string) {
  return {
    content: content.slice(0, 1800),
    msg_type: 0,
    ...(messageId ? { msg_id: messageId } : {}),
  };
}

export async function sendQqBotMessage(
  config: QqBotConfig,
  conversation: QqBotConversation,
  content: string,
  messageId?: string,
) {
  const token = await getAccessToken(config);
  const response = await fetch(messageUrl(config, conversation), {
    method: "POST",
    headers: {
      Authorization: `QQBot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildMessageBody(content, messageId)),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`QQ Bot 消息发送失败：${response.status} ${text.slice(0, 200)}`);
  }
}
