/** Build copyable client instructions from the page origin, never from credentials. */
export function liliClientConnection(origin: string) {
  const parsed = new URL(origin);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash ||
    !(parsed.protocol === "https:" || parsed.protocol === "http:" && loopback)) {
    throw new Error("Lili 连接地址必须使用 HTTPS，或本机 loopback HTTP。");
  }
  const endpoint = new URL("/api/lili/mcp", parsed).href;
  return {
    endpoint,
    toml: `[mcp_servers.lili]\nurl = ${JSON.stringify(endpoint)}\n`,
    loginCommand: "codex mcp login lili",
    verifyPrompt: "请检查当前会话是否有 Lili MCP 工具，调用 lili_ping，确认 authenticated=true，并列出实际可用工具。不要用普通 HTTP 成功代替原生 MCP 验收。",
  };
}
