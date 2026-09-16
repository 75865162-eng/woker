import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { validateWeComWebhookUrl } from "@/lib/notifications/wecom";

export const runtime = "nodejs";

interface WeComWebhookResponse {
  errcode?: number;
  errmsg?: string;
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("settings", "view", request);

    if (!permission.ok) {
      return permission.response;
    }

    const body = (await request.json()) as { webhookUrl?: string; message?: string };
    const webhookUrl = body.webhookUrl?.trim() ?? "";
    const message = body.message?.trim() ?? "";

    if (!validateWeComWebhookUrl(webhookUrl)) {
      return NextResponse.json({ error: "企业微信 Webhook 地址无效，请检查是否为群机器人地址。" }, { status: 400 });
    }

    if (!message) {
      return NextResponse.json({ error: "通知内容不能为空。" }, { status: 400 });
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: {
          content: message.slice(0, 3900),
        },
      }),
    });
    const data = (await response.json().catch(() => ({}))) as WeComWebhookResponse;

    if (!response.ok || data.errcode !== 0) {
      return NextResponse.json(
        { error: `企业微信发送失败：${data.errmsg || response.statusText || "未知错误"}` },
        { status: 502 },
      );
    }

    return NextResponse.json({
      result: {
        sent: true,
        errmsg: data.errmsg ?? "ok",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "企业微信通知发送失败。" },
      { status: 500 },
    );
  }
}
