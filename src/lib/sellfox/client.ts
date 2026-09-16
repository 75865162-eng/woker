import { createHmac, randomInt } from "node:crypto";

const baseUrl = "https://openapi.sellfox.com";
const requestTimeoutMs = Math.min(Math.max(Number(process.env.SELLFOX_REQUEST_TIMEOUT_MS) || 30_000, 5_000), 120_000);
let cachedToken: { value: string; expiresAt: number } | null = null;

type SellfoxEnvelope<T> = { code?: number; msg?: string; data?: T };

function credentials() {
  const clientId = process.env.SELLFOX_CLIENT_ID;
  const clientSecret = process.env.SELLFOX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("未配置 SELLFOX_CLIENT_ID 和 SELLFOX_CLIENT_SECRET。");
  }

  return { clientId, clientSecret };
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const { clientId, clientSecret } = credentials();
  const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" });
  const { response, payload } = await fetchJsonWithTimeout<{ access_token?: string; expires_in?: number }>(`${baseUrl}/api/oauth/v2/token.json?${params}`, { cache: "no-store" });

  if (!response.ok || payload.code || !payload.data?.access_token) {
    throw new Error(payload.msg || "赛狐 Token 获取失败。");
  }

  cachedToken = {
    value: payload.data.access_token,
    expiresAt: Date.now() + Math.max((payload.data.expires_in ?? 86_400_000) - 60_000, 60_000),
  };
  return cachedToken.value;
}

async function fetchJsonWithTimeout<T>(input: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const payload = (await response.json()) as SellfoxEnvelope<T>;
    return { response, payload };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`赛狐接口请求超时（${Math.round(requestTimeoutMs / 1000)} 秒）。`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sellfoxPost<T>(path: string, body: unknown): Promise<T> {
  const { clientId, clientSecret } = credentials();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const accessToken = await getAccessToken();
    const timestamp = String(Date.now());
    const nonce = String(randomInt(1, 999_999_999));
    const values = { access_token: accessToken, client_id: clientId, method: "post", nonce, timestamp, url: path };
    const signSource = Object.entries(values).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("&");
    const sign = createHmac("sha256", clientSecret).update(signSource).digest("hex");
    const query = new URLSearchParams({ access_token: accessToken, client_id: clientId, timestamp, nonce, sign });

    try {
      const result = await fetchJsonWithTimeout<T>(`${baseUrl}${path}?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const { response, payload } = result;

      const tokenExpired = payload.code === 40001 || payload.msg?.includes("access_token");
      if (tokenExpired) cachedToken = null;
      if (tokenExpired && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
        continue;
      }
      if (payload.code === 40019 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
        continue;
      }
      if (!response.ok || (payload.code && payload.code !== 0)) {
        throw new Error(payload.msg || `赛狐接口调用失败 (${response.status})。`);
      }
      return payload.data as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("赛狐接口调用失败。");
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("赛狐接口调用超过限制，请稍后重试。");
}
