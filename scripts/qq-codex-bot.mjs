import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";

const config = {
  appId: readRequiredEnv("QQ_BOT_APP_ID"),
  secret: readRequiredEnv("QQ_BOT_SECRET"),
  apiBaseUrl: process.env.QQ_BOT_API_BASE_URL?.trim() || "https://api.bot.qq.com",
  codexEnabled: process.env.QQ_BOT_CODEX_ENABLED !== "false",
  codexBin: process.env.QQ_BOT_CODEX_BIN?.trim() || "codex",
  codexWorkdir: process.env.QQ_BOT_CODEX_WORKDIR?.trim() || process.cwd(),
  codexSandbox: parseSandbox(process.env.QQ_BOT_CODEX_SANDBOX),
  codexModel: process.env.QQ_BOT_CODEX_MODEL?.trim() || "",
  allowedUserIds: parseCsv(process.env.QQ_BOT_ALLOWED_USER_IDS),
  intents: Number(process.env.QQ_BOT_WS_INTENTS || 1107296256),
  reconnectMs: Number(process.env.QQ_BOT_WS_RECONNECT_MS || 5000),
  debugEvents: process.env.QQ_BOT_DEBUG_EVENTS !== "false",
};

const COMMAND_PREFIXES = ["/code", "/status"];
const processedEvents = new Set();
const tasks = new Map();
let accessTokenCache;
let ws;
let heartbeatTimer;
let lastSeq = null;
let reconnectTimer;
let reconnecting = false;
let messageSeq = Date.now() % 1_000_000;

main().catch((error) => {
  console.error("[qq-codex-bot] 启动失败：", error.message);
  process.exit(1);
});

async function main() {
  await mkdir("/tmp/qq-codex-bot", { recursive: true });
  console.log("[qq-codex-bot] 启动中，工作目录：", config.codexWorkdir);
  console.log("[qq-codex-bot] WebSocket intents：", config.intents);
  await connectGateway();

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 未配置`);
  return value;
}

function parseCsv(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSandbox(value) {
  if (value === "read-only" || value === "danger-full-access") return value;
  return "workspace-write";
}

async function getAccessToken() {
  const now = Date.now();
  if (accessTokenCache && accessTokenCache.expiresAt > now + 60_000) {
    return accessTokenCache.token;
  }

  const response = await fetch(`${config.apiBaseUrl}/app/getAppAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appId: config.appId,
      clientSecret: config.secret,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`获取 QQ Bot access token 失败：${response.status}`);
  }

  accessTokenCache = {
    token: data.access_token,
    expiresAt: now + Math.max(60, data.expires_in || 600) * 1000,
  };
  return accessTokenCache.token;
}

async function getGatewayUrl(token) {
  const headers = { Authorization: `QQBot ${token}` };
  const botResponse = await fetch(`${config.apiBaseUrl}/gateway/bot`, { headers });
  if (botResponse.ok) {
    const data = await botResponse.json();
    if (data.url) return data.url;
  }

  const response = await fetch(`${config.apiBaseUrl}/gateway`, { headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.url) {
    throw new Error(`获取 QQ Bot WebSocket 网关失败：${response.status}`);
  }
  return data.url;
}

async function connectGateway() {
  const token = await getAccessToken();
  const gatewayUrl = await getGatewayUrl(token);
  console.log("[qq-codex-bot] 连接网关：", gatewayUrl.replace(/\?.*$/, ""));

  ws = new WebSocket(gatewayUrl);
  ws.addEventListener("open", () => {
    console.log("[qq-codex-bot] WebSocket 已连接，等待 Hello");
  });
  ws.addEventListener("message", (event) => {
    void handleGatewayMessage(event.data, token);
  });
  ws.addEventListener("close", (event) => {
    console.warn("[qq-codex-bot] WebSocket 已断开：", event.code, event.reason || "");
    scheduleReconnect();
  });
  ws.addEventListener("error", () => {
    console.error("[qq-codex-bot] WebSocket 连接错误");
  });
}

async function handleGatewayMessage(rawData, token) {
  const text = typeof rawData === "string" ? rawData : Buffer.from(await rawData.arrayBuffer()).toString("utf8");
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    console.warn("[qq-codex-bot] 收到无法解析的网关消息");
    return;
  }

  if (typeof payload.s === "number") lastSeq = payload.s;

  switch (payload.op) {
    case 0:
      await handleDispatch(payload);
      break;
    case 7:
      console.warn("[qq-codex-bot] 网关要求重连");
      scheduleReconnect();
      break;
    case 9:
      console.warn("[qq-codex-bot] Session 无效，重新 Identify");
      identify(token);
      break;
    case 10:
      startHeartbeat(payload.d?.heartbeat_interval);
      identify(token);
      break;
    case 11:
      break;
    default:
      console.log("[qq-codex-bot] 网关事件 op：", payload.op);
  }
}

function startHeartbeat(interval) {
  clearInterval(heartbeatTimer);
  const heartbeatInterval = Number(interval || 45_000);
  heartbeatTimer = setInterval(() => {
    sendGatewayPayload({ op: 1, d: lastSeq });
  }, heartbeatInterval);
  sendGatewayPayload({ op: 1, d: lastSeq });
}

function identify(token) {
  sendGatewayPayload({
    op: 2,
    d: {
      token: `QQBot ${token}`,
      intents: config.intents,
      shard: [0, 1],
      properties: {
        os: platform(),
        browser: "codex-qq-bot",
        device: "codex-qq-bot",
      },
    },
  });
}

function sendGatewayPayload(payload) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(payload));
}

async function handleDispatch(payload) {
  if (payload.id && processedEvents.has(payload.id)) return;
  if (payload.id) {
    processedEvents.add(payload.id);
    if (processedEvents.size > 1000) processedEvents.clear();
  }

  if (payload.t === "READY") {
    console.log("[qq-codex-bot] READY，机器人已在线");
    return;
  }

  const message = payload.d;
  if (config.debugEvents) {
    console.log("[qq-codex-bot] 收到事件：", payload.t, summarizeEvent(message));
  }
  if (!message || typeof message.content !== "string") return;

  const command = parseCommand(message);
  if (!command) return;

  if (!isAllowed(command.userId)) {
    await sendMessage(command.conversation, "你暂时没有使用 Codex Bot 的权限。", command.messageId);
    return;
  }

  if (command.name === "status") {
    await sendStatus(command);
    return;
  }

  if (!config.codexEnabled) {
    await sendMessage(command.conversation, "Codex Bot 当前未启用。", command.messageId);
    return;
  }

  await sendMessage(command.conversation, "收到，正在让 Codex 处理。完成后我会把结果发回来。", command.messageId);
  void runCodexAndReply(command);
}

function parseCommand(message) {
  const conversation = resolveConversation(message);
  if (!conversation) return null;

  const content = normalizeContent(message.content);
  if (!content) return null;

  const prefix = COMMAND_PREFIXES.find((candidate) => content === candidate || content.startsWith(`${candidate} `));
  const name = prefix ? prefix.slice(1) : "code";
  const args = prefix ? content.slice(prefix.length).trim() : content;
  if (!args && name === "code") return null;

  return {
    name,
    args,
    messageId: message.id,
    userId: message.author?.id || message.user_openid,
    conversation,
  };
}

function resolveConversation(message) {
  if (message.group_openid) return { kind: "group", openid: message.group_openid };
  if (message.user_openid) return { kind: "c2c", openid: message.user_openid };
  if (message.author?.user_openid) return { kind: "c2c", openid: message.author.user_openid };
  if (message.channel_id) return { kind: "channel", channelId: message.channel_id };
  return null;
}

function summarizeEvent(message) {
  if (!message || typeof message !== "object") return "";
  return {
    hasContent: typeof message.content === "string",
    group: Boolean(message.group_openid),
    c2c: Boolean(message.user_openid || message.author?.user_openid),
    channel: Boolean(message.channel_id),
    keys: Object.keys(message).slice(0, 12),
    authorKeys: message.author && typeof message.author === "object" ? Object.keys(message.author).slice(0, 12) : [],
    contentPreview: typeof message.content === "string" ? message.content.trim().slice(0, 40) : "",
  };
}

function normalizeContent(content) {
  return content
    .replace(/<@![^>]+>/g, "")
    .replace(/<@[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAllowed(userId) {
  if (config.allowedUserIds.length === 0) return true;
  return Boolean(userId && config.allowedUserIds.includes(userId));
}

async function sendStatus(command) {
  const task = tasks.get(command.args);
  const message = task
    ? `任务 ${task.id}：${task.status}${task.finishedAt ? `，耗时 ${Math.round((task.finishedAt - task.startedAt) / 1000)} 秒` : ""}`
    : `没有找到任务 ${command.args}`;
  await sendMessage(command.conversation, message, command.messageId);
}

async function runCodexAndReply(command) {
  const id = randomUUID().slice(0, 8);
  const task = {
    id,
    status: "running",
    prompt: command.args,
    startedAt: Date.now(),
  };
  tasks.set(id, task);

  try {
    const output = await runCodexTask(id, command.args);
    task.status = "done";
    task.finishedAt = Date.now();
    task.output = output;
    await sendMessage(command.conversation, formatCodexResult(id, true, output), command.messageId);
  } catch (error) {
    task.status = "failed";
    task.finishedAt = Date.now();
    task.output = error instanceof Error ? error.message : String(error);
    await sendMessage(command.conversation, formatCodexResult(id, false, task.output), command.messageId);
  }
}

async function runCodexTask(id, userPrompt) {
  const outputFile = join("/tmp/qq-codex-bot", `${id}.txt`);
  const args = [
    "exec",
    "--cd",
    config.codexWorkdir,
    "--sandbox",
    config.codexSandbox,
    "--output-last-message",
    outputFile,
  ];
  if (config.codexModel) args.push("--model", config.codexModel);
  args.push("-");

  const prompt = [
    "你正在通过 QQ Bot 为用户执行 Codex 代码任务。",
    "请在当前仓库内完成用户请求，遵守 AGENTS.md，保持改动最小。",
    "如果需要修改代码，直接实现并验证；如果无法完成，说明阻塞原因。",
    "",
    "用户请求：",
    userPrompt,
  ].join("\n");

  return await new Promise((resolve, reject) => {
    const child = spawn(config.codexBin, args, {
      cwd: config.codexWorkdir,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks = [];

    child.stdout.on("data", (chunk) => chunks.push(chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => chunks.push(chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      void readFile(outputFile, "utf8")
        .catch(() => chunks.join("").trim())
        .then((lastMessage) => {
          const output = lastMessage.trim() || chunks.join("").trim();
          if (code === 0) {
            resolve(output || "Codex 已完成，但没有返回文本。");
          } else {
            reject(new Error(output || `Codex 退出码：${code}`));
          }
        });
    });
    child.stdin.end(prompt);
  });
}

function messageUrl(conversation) {
  if (conversation.kind === "group") return `${config.apiBaseUrl}/v2/groups/${conversation.openid}/messages`;
  if (conversation.kind === "c2c") return `${config.apiBaseUrl}/v2/users/${conversation.openid}/messages`;
  return `${config.apiBaseUrl}/channels/${conversation.channelId}/messages`;
}

async function sendMessage(conversation, content, messageId) {
  const token = await getAccessToken();
  const body = {
    content: content.slice(0, 1800),
    msg_type: 0,
    msg_seq: nextMessageSeq(),
    ...(messageId ? { msg_id: messageId } : {}),
  };

  const response = await fetch(messageUrl(conversation), {
    method: "POST",
    headers: {
      Authorization: `QQBot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("[qq-codex-bot] 发送消息失败：", response.status, text.slice(0, 200));
  }
}

function nextMessageSeq() {
  messageSeq = (messageSeq + 1) % 1_000_000;
  return messageSeq || 1;
}

function formatCodexResult(taskId, ok, output) {
  const title = ok ? `Codex 任务 ${taskId} 完成` : `Codex 任务 ${taskId} 失败`;
  return `${title}\n\n${output}`.slice(0, 1800);
}

function scheduleReconnect() {
  clearInterval(heartbeatTimer);
  if (reconnecting) return;
  reconnecting = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnecting = false;
    void connectGateway().catch((error) => {
      console.error("[qq-codex-bot] 重连失败：", error.message);
      scheduleReconnect();
    });
  }, config.reconnectMs);
}

function shutdown() {
  console.log("\n[qq-codex-bot] 正在关闭");
  clearInterval(heartbeatTimer);
  clearTimeout(reconnectTimer);
  if (ws) ws.close();
  process.exit(0);
}
