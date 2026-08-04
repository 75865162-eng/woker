import { NextResponse } from "next/server";
import { parseQqBotCommand } from "@/lib/qq-bot/commands";
import { getQqBotConfig } from "@/lib/qq-bot/config";
import { sendQqBotMessage } from "@/lib/qq-bot/client";
import { getCodexTask, runCodexTask } from "@/lib/qq-bot/codex-runner";
import { signQqBotValidation, verifyQqBotRequest } from "@/lib/qq-bot/crypto";
import {
  isQqBotMessageData,
  isQqBotValidationData,
  type QqBotCallbackPayload,
} from "@/lib/qq-bot/types";

export const runtime = "nodejs";

const OP_DISPATCH = 0;
const OP_HTTP_CALLBACK_ACK = 12;
const OP_HTTP_CALLBACK_VALIDATE = 13;

function formatCodexResult(taskId: string, ok: boolean, output: string) {
  const title = ok ? `Codex 任务 ${taskId} 完成` : `Codex 任务 ${taskId} 失败`;
  return `${title}\n\n${output}`.slice(0, 1800);
}

function ack() {
  return NextResponse.json({ op: OP_HTTP_CALLBACK_ACK });
}

function isUserAllowed(config: ReturnType<typeof getQqBotConfig>, userId?: string) {
  if (config.allowedUserIds.length === 0) return true;
  return Boolean(userId && config.allowedUserIds.includes(userId));
}

function handleCommandInBackground(config: ReturnType<typeof getQqBotConfig>, command: NonNullable<ReturnType<typeof parseQqBotCommand>>) {
  if (!command.conversation) return;
  const conversation = command.conversation;

  void (async () => {
    try {
      if (!isUserAllowed(config, command.userId)) {
        await sendQqBotMessage(config, conversation, "你暂时没有使用 Codex Bot 的权限。", command.messageId);
        return;
      }

      if (command.name === "status") {
        const task = getCodexTask(command.args);
        const message = task
          ? `任务 ${task.id}：${task.status}${task.finishedAt ? `，耗时 ${Math.round((task.finishedAt - task.startedAt) / 1000)} 秒` : ""}`
          : `没有找到任务 ${command.args}`;
        await sendQqBotMessage(config, conversation, message, command.messageId);
        return;
      }

      if (command.name !== "code") {
        await sendQqBotMessage(config, conversation, "当前先支持 /code 和 /status。", command.messageId);
        return;
      }

      if (!config.codexEnabled) {
        await sendQqBotMessage(config, conversation, "Codex Bot 当前未启用。", command.messageId);
        return;
      }

      await sendQqBotMessage(config, conversation, "收到，正在让 Codex 处理。完成后我会把结果发回来。", command.messageId);
      const result = await runCodexTask(config, command.args);
      await sendQqBotMessage(config, conversation, formatCodexResult(result.id, result.ok, result.output), command.messageId);
    } catch (error) {
      console.error("QQ Bot Codex command failed", error);
    }
  })();
}

export async function GET() {
  try {
    const config = getQqBotConfig();
    return NextResponse.json({
      result: {
        configured: true,
        appId: config.appId,
        sandbox: config.sandbox,
        signatureCheckEnabled: config.signatureCheckEnabled,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "QQ Bot 未配置。" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  let config;
  try {
    config = getQqBotConfig();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "QQ Bot 未配置。" },
      { status: 503 },
    );
  }

  const rawBody = await request.text();

  let payload: QqBotCallbackPayload;
  try {
    payload = JSON.parse(rawBody) as QqBotCallbackPayload;
  } catch {
    return NextResponse.json({ error: "QQ Bot 回调 JSON 无效。" }, { status: 400 });
  }

  if (payload.op === OP_HTTP_CALLBACK_VALIDATE) {
    if (!isQqBotValidationData(payload.d)) {
      return NextResponse.json({ error: "QQ Bot 地址验证数据无效。" }, { status: 400 });
    }

    return NextResponse.json({
      plain_token: payload.d.plain_token,
      signature: signQqBotValidation(config.secret, payload.d.event_ts, payload.d.plain_token),
    });
  }

  if (config.signatureCheckEnabled) {
    const verified = verifyQqBotRequest(
      config.secret,
      request.headers.get("x-signature-timestamp"),
      request.headers.get("x-signature-ed25519"),
      rawBody,
    );

    if (!verified) {
      return NextResponse.json({ error: "QQ Bot 请求签名校验失败。" }, { status: 401 });
    }
  }

  if (payload.op !== OP_DISPATCH) {
    return ack();
  }

  if (isQqBotMessageData(payload.d)) {
    const command = parseQqBotCommand(payload.d);
    if (command) {
      console.info("QQ Bot command received", {
        event: payload.t,
        command: command.name,
        hasArgs: command.args.length > 0,
        sourceId: command.sourceId,
        userId: command.userId,
      });
      handleCommandInBackground(config, command);
    }
  }

  return ack();
}
