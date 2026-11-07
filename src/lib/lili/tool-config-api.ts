import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { ToolConfigInputError, publicXiyouSettings, xiyouEndpoint, type XiyouSettings } from "./tool-config";
import type { ToolConfigStore } from "./tool-config-server";

export type ToolConfigDependencies = { store: ToolConfigStore; probe?: typeof probeXiyouConnection };

/** Only MCP initialization; no tool call, workflow, redirect or business data query. */
export async function probeXiyouConnection(settings: XiyouSettings, transport: typeof fetch = fetch) {
  if (!settings.mcpToken || settings.mcpUrl !== xiyouEndpoint) throw new ToolConfigInputError("请先保存有效的西柚 MCP Token。");
  const response = await transport(xiyouEndpoint, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${settings.mcpToken}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: "lili-connection-test", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "erp-lili", version: "1.0.0" } } }),
  });
  const reader = response.body?.getReader();
  let text = "";
  let length = 0;
  const decoder = new TextDecoder();
  let envelope: Record<string, unknown> | undefined;
  function parse(body: string) {
    try {
      const candidate = JSON.parse(body);
      if (candidate && typeof candidate === "object" && candidate.id === "lili-connection-test") envelope = candidate;
    } catch { /* An SSE frame can span several network chunks. */ }
  }
  try {
    if (!response.ok) throw new Error("Provider HTTP failure");
    while (reader && !envelope) {
      const { done, value } = await reader.read();
      if (done) { text += decoder.decode(); break; }
      length += value.byteLength;
      if (length > 65_536) throw new Error("Provider response too large");
      text += decoder.decode(value, { stream: true });
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        const frames = text.replaceAll("\r\n", "\n").split("\n\n");
        text = frames.pop() ?? "";
        for (const frame of frames) parse(frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n"));
      } else parse(text);
    }
    if (!envelope) parse(text);
    const result = envelope?.result as Record<string, unknown> | undefined;
    if (!envelope || envelope.jsonrpc !== "2.0" || envelope.error || !result || typeof result.protocolVersion !== "string" || !result.serverInfo || typeof result.serverInfo !== "object") throw new Error("Invalid MCP initialize response");
  } finally { await reader?.cancel().catch(() => undefined); reader?.releaseLock(); }
}

export async function handleToolConfiguration(
  request: Request, key: string, body: Record<string, unknown> | undefined,
  user: { id: string; organizationId: string }, dependencies?: ToolConfigDependencies,
): Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  try {
    if (request.method !== "GET" && body?.id !== "xiyou") return json({ message: "请选择西柚配置；卖家精灵沿用主系统已有配置接口。" }, 400);
    const store = dependencies?.store ?? (await import("./tool-config-server")).toolConfigStore;
    const scope = { organizationId: user.organizationId, userId: user.id, workspaceId: workspaceScopeFromRequest(request, body).workspaceId };
    if (request.method === "GET") return json({ settings: publicXiyouSettings(await store.read(scope)) });
    if (key === "tool-config" && request.method === "PUT") {
      const settings = await store.save(scope, body?.settings);
      return json({ settings: publicXiyouSettings(settings), message: "已保存西柚配置；尚未验证连接。" });
    }
    const settings = await store.read(scope);
    if (!settings.enabled || !settings.mcpToken) return json({ message: "请先保存并启用西柚 MCP 配置。" }, 400);
    await (dependencies?.probe ?? probeXiyouConnection)(settings);
    return json({ ok: true, message: "西柚 MCP 初始化已响应；未执行业务工具或工作流。" });
  } catch (error) {
    if (error instanceof ToolConfigInputError) return json({ message: error.message }, 400);
    return json({ message: key === "tool-config/test" ? "西柚连接测试失败，请检查 Token、网络及服务状态。" : "西柚配置读取或保存失败，请检查数据库及服务端加密密钥后重试。" }, 503);
  }
}
