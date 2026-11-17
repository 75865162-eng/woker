/**
 * AI 接口错误脱敏工具。
 *
 * 原则：上游响应体只用于「分类」，绝不进入返回给客户端的对象。
 * 用户看到的是白名单安全文案；排查信息只写服务端日志并做脱敏。
 */

export type AiTestFailure =
  | { kind: "missing_key" }
  | { kind: "timeout"; seconds: number }
  | { kind: "network" }
  | { kind: "auth" }
  | { kind: "rate_limit" }
  | { kind: "upstream"; status: number }
  | { kind: "config" };

/** 从上游错误文本提取安全信号。传入的 body 仅用于本函数内部判断，返回值不含原文。 */
export function classifyUpstreamError(status: number, body: string): AiTestFailure {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403 || lower.includes("invalid api key") || lower.includes("unauthorized") || lower.includes("incorrect api key")) {
    return { kind: "auth" };
  }
  if (status === 429 || lower.includes("rate limit") || lower.includes("too many requests")) {
    return { kind: "rate_limit" };
  }
  if (status >= 500) {
    return { kind: "upstream", status };
  }
  if (status === 400 || status === 404 || lower.includes("invalid request") || lower.includes("model")) {
    return { kind: "config" };
  }
  return { kind: "upstream", status };
}

/** 用户可见的安全文案（白名单，无上游原文、无密钥、无内网地址）。 */
export function aiFailureMessage(failure: AiTestFailure): { error: string; status: number } {
  switch (failure.kind) {
    case "missing_key":
      return { error: "缺少 API Key，请先保存大模型配置。", status: 400 };
    case "timeout":
      return { error: `测试请求超时：${failure.seconds} 秒内没有返回，请检查网络或增大超时时间。`, status: 504 };
    case "network":
      return { error: "无法连接 AI 服务，请检查网络、代理或 Base URL 是否正确。", status: 502 };
    case "auth":
      return { error: "API Key 无效或没有权限，请更换 Key 后重试。", status: 401 };
    case "rate_limit":
      return { error: "请求被限流，请稍后重试或更换 Key。", status: 429 };
    case "upstream":
      return { error: `AI 服务返回错误（HTTP ${failure.status}），请稍后重试。`, status: 502 };
    case "config":
      return { error: "配置或请求格式有误，请检查 Base URL、接口类型与模型名。", status: 400 };
  }
}

/** 服务端日志脱敏：移除 key/token/URL 后截断。仅用于 console，绝不进入 HTTP 响应。 */
export function redactForLog(body: string, maxLength = 500): string {
  return body
    .replace(/sk-[A-Za-z0-9_-]{4,}/g, "sk-***")
    .replace(/(Bearer|api[_-]?key)\s+[^\s"',}]+/gi, "$1 ***")
    .replace(/https?:\/\/[^\s"'<>]+/g, "<url>")
    .slice(0, maxLength);
}

/**
 * 把服务端配置的内网 Base URL 收敛为 scheme://host，去掉 path/query/userinfo。
 * 用于成功响应中确认「连的是哪个端点」，不泄露内网路径结构。
 */
export function safeBaseUrl(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}
