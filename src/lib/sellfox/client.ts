import { createHmac, randomInt } from "node:crypto";
import { Client } from "pg";

const baseUrl = "https://openapi.sellfox.com";
const requestTimeoutMs = Math.min(Math.max(Number(process.env.SELLFOX_REQUEST_TIMEOUT_MS) || 30_000, 5_000), 120_000);
let cachedToken: { value: string; expiresAt: number } | null = null;
let cachedTokenRequest: Promise<string> | null = null;
let requestTail: Promise<void> = Promise.resolve();
let lastRequestFinishedAt = 0;
let lockClientReady: Promise<Client> | null = null;

type SellfoxEnvelope<T> = { code?: number; msg?: string; data?: T };
type HttpRequest = { url: string; init: RequestInit };

export class SellfoxRequestError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code?: number) {
    super(message);
    this.name = "SellfoxRequestError";
  }
}

function credentials() {
  const clientId = process.env.SELLFOX_CLIENT_ID;
  const clientSecret = process.env.SELLFOX_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new SellfoxRequestError("未配置 SELLFOX_CLIENT_ID 和 SELLFOX_CLIENT_SECRET。", false);
  return { clientId, clientSecret };
}

function responseError(response: Response, code?: number) {
  // An explicit business error takes precedence over a transient HTTP status.
  const retryable = code ? code === 40019 || code === -1 : response.status === 429 || response.status >= 500;
  return new SellfoxRequestError(`赛狐接口调用失败（HTTP ${response.status}${code ? ` / ${code}` : ""}）。`, retryable, code);
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  if (!cachedTokenRequest) {
    cachedTokenRequest = (async () => {
      const { clientId, clientSecret } = credentials();
      const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" });
      const { response, payload } = await fetchJsonWithTimeout<{ access_token?: string; expires_in?: number }>(() => ({
        url: `${baseUrl}/api/oauth/v2/token.json?${params}`, init: { cache: "no-store" },
      }));
      if (!response.ok || payload.code) throw responseError(response, payload.code);
      const ttlMs = payload.data?.expires_in;
      const token = payload.data?.access_token;
      if (typeof token !== "string" || !token || typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
        throw new SellfoxRequestError("赛狐 Token 响应缺少有效凭证或毫秒有效期。", false);
      }
      // Sellfox expires_in is milliseconds. Refresh early without extending short TTLs.
      cachedToken = { value: token, expiresAt: Date.now() + ttlMs - Math.min(60_000, ttlMs * 0.1) };
      return token;
    })();
  }
  const pending = cachedTokenRequest;
  try { return await pending; }
  finally { if (cachedTokenRequest === pending) cachedTokenRequest = null; }
}

async function getLockClient() {
  if (!lockClientReady) {
    const pending = (async () => {
      const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: requestTimeoutMs });
      client.on("error", () => {
        if (lockClientReady === pending) lockClientReady = null;
        void client.end().catch(() => undefined);
      });
      client.on("end", () => { if (lockClientReady === pending) lockClientReady = null; });
      try { await client.connect(); }
      catch (error) { await client.end().catch(() => undefined); throw error; }
      return client;
    })();
    lockClientReady = pending;
  }
  const pending = lockClientReady;
  try { return await pending; }
  catch {
    if (lockClientReady === pending) lockClientReady = null;
    throw new SellfoxRequestError("赛狐全局限流连接不可用，未发送请求。", true);
  }
}

async function fetchJsonWithTimeout<T>(buildRequest: () => HttpRequest) {
  const request = requestTail.then(async () => {
    let lockClient: Client | null = null;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let disconnected = false;
    const abortOnDisconnect = () => { disconnected = true; controller.abort(); };
    try {
      if (process.env.DATABASE_URL) {
        lockClient = await getLockClient();
        lockClient.on("error", abortOnDisconnect);
        lockClient.on("end", abortOnDisconnect);
        await lockClient.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", ["sellfox-open-api-global-rate-limit"]);
        await new Promise((resolve) => setTimeout(resolve, 1_200));
      } else {
        const waitMs = Math.max(0, lastRequestFinishedAt + 1_200 - Date.now());
        if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      if (disconnected) throw new SellfoxRequestError("赛狐全局限流连接已断开，未发送请求。", true);
      // Build timestamp/nonce/sign after waiting for the global queue.
      const { url, init } = buildRequest();
      timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      const response = await fetch(url, { ...init, signal: controller.signal });
      let payload: SellfoxEnvelope<T>;
      try { payload = await response.json() as SellfoxEnvelope<T>; }
      catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw response.ok ? new SellfoxRequestError("赛狐接口返回非 JSON 响应。", false) : responseError(response);
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || (payload.code !== undefined && typeof payload.code !== "number")) {
        throw new SellfoxRequestError("赛狐接口响应格式无法识别。", false);
      }
      return { response, payload };
    } catch (error) {
      if (error instanceof SellfoxRequestError) throw error;
      if (disconnected) throw new SellfoxRequestError("赛狐全局限流连接已断开，本次请求已停止。", true);
      if (error instanceof Error && error.name === "AbortError") {
        throw new SellfoxRequestError(`赛狐接口请求超时（${Math.round(requestTimeoutMs / 1000)} 秒）。`, true);
      }
      throw new SellfoxRequestError("赛狐接口请求或限流连接暂时失败。", true);
    } finally {
      if (timeout) clearTimeout(timeout);
      lastRequestFinishedAt = Date.now();
      if (lockClient) {
        try { if (!disconnected) await lockClient.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", ["sellfox-open-api-global-rate-limit"]); }
        catch {
          lockClientReady = null;
          await lockClient.end().catch(() => undefined);
        }
        finally {
          lockClient.removeListener("error", abortOnDisconnect);
          lockClient.removeListener("end", abortOnDisconnect);
        }
      }
    }
  });
  requestTail = request.then(() => undefined, () => undefined);
  return request;
}

export async function sellfoxPost<T>(path: string, body: unknown): Promise<T> {
  const { clientId, clientSecret } = credentials();
  let refreshedToken = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const accessToken = await getAccessToken();
      const { response, payload } = await fetchJsonWithTimeout<T>(() => {
        const timestamp = String(Date.now());
        const nonce = String(randomInt(1, 999_999_999));
        const values = { access_token: accessToken, client_id: clientId, method: "post", nonce, timestamp, url: path };
        const signSource = Object.entries(values).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("&");
        const sign = createHmac("sha256", clientSecret).update(signSource).digest("hex");
        const query = new URLSearchParams({ access_token: accessToken, client_id: clientId, timestamp, nonce, sign });
        return { url: `${baseUrl}${path}?${query}`, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" } };
      });
      if (payload.code === 40001) {
        if (cachedToken?.value === accessToken) cachedToken = null;
        if (!refreshedToken && attempt < 3) { refreshedToken = true; continue; }
      }
      if (!response.ok || payload.code) throw responseError(response, payload.code);
      return payload.data as T;
    } catch (error) {
      if (!(error instanceof SellfoxRequestError) || !error.retryable || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * 2 ** attempt + randomInt(0, 251)));
    }
  }
  throw new SellfoxRequestError("赛狐接口调用超过重试限制。", false);
}
