type SecurityEnvironment = {
  NODE_ENV?: string;
  AUTH_PUBLIC_ORIGIN?: string;
  AUTH_TRUSTED_PROXY?: string;
};

export class RequestSecurityConfigurationError extends Error {}

function isLoopback(url: URL) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

// 生产入口只取显式配置；转发头和 Host 均不是来源或协议的信任依据。
export function getPublicOrigin(request: Pick<Request, "url">, env: SecurityEnvironment = process.env): string {
  const configured = env.AUTH_PUBLIC_ORIGIN;
  if (!configured) {
    if (env.NODE_ENV === "production") {
      throw new RequestSecurityConfigurationError("生产环境必须配置 AUTH_PUBLIC_ORIGIN。");
    }
    return new URL(request.url).origin;
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new RequestSecurityConfigurationError("AUTH_PUBLIC_ORIGIN 必须是完整可信来源。");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new RequestSecurityConfigurationError("AUTH_PUBLIC_ORIGIN 只能包含协议、主机和端口。");
  }
  if (env.NODE_ENV === "production") {
    // 隔离 fixture 必须显式声明 loopback HTTP 来源；不默认信任任何代理头。
    if (url.protocol !== "https:" && !isLoopback(url)) {
      throw new RequestSecurityConfigurationError("生产公网 AUTH_PUBLIC_ORIGIN 必须使用 HTTPS。");
    }
    if (!isLoopback(url) && env.AUTH_TRUSTED_PROXY !== "caddy") {
      throw new RequestSecurityConfigurationError("生产公网入口必须配置 AUTH_TRUSTED_PROXY=caddy 并部署覆盖客户端 IP 头的 Caddy 合同。");
    }
  }
  return url.origin;
}

export function isSecureRequest(request: Pick<Request, "url">, env: SecurityEnvironment = process.env) {
  return new URL(getPublicOrigin(request, env)).protocol === "https:";
}

// 仅在部署已声明 Caddy 边界时读取其覆盖的单一头；不接受 XFF/X-Real-IP。
export function getTrustedClientIp(request: Pick<Request, "url" | "headers">, env: SecurityEnvironment = process.env) {
  const origin = new URL(getPublicOrigin(request, env));
  if (env.AUTH_TRUSTED_PROXY !== "caddy") {
    if (env.NODE_ENV === "production" && !isLoopback(origin)) {
      throw new RequestSecurityConfigurationError("生产公网登录缺少可信客户端 IP 入口。");
    }
    return "";
  }
  const ip = request.headers.get("x-erp-client-ip") ?? "";
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split(".").every(part => Number(part) <= 255);
  let ipv6 = false;
  if (ip.includes(":")) {
    try { ipv6 = new URL(`http://[${ip}]/`).hostname.startsWith("["); } catch { /* 非法 IPv6 不予信任。 */ }
  }
  if (!ipv4 && !ipv6) {
    throw new RequestSecurityConfigurationError("可信 Caddy 客户端 IP 头缺失或不是单一地址。");
  }
  return ip;
}
