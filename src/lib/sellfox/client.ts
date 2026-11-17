import { createHmac, randomInt } from "node:crypto";
import { Client } from "pg";
import { currentSellfoxCredentials } from "./credential-context";
import type { SellfoxResolvedCredentials } from "./credential-store";

const baseUrl = "https://openapi.sellfox.com";
const requestTimeoutMs = Math.min(Math.max(Number(process.env.SELLFOX_REQUEST_TIMEOUT_MS) || 30_000, 5_000), 120_000);
type TokenState = { token: { value: string; expiresAt: number } | null; pending: Promise<string> | null };
const tokenStates = new Map<string, TokenState>();
function tokenState(namespace: string) {
  let state = tokenStates.get(namespace);
  if (!state) {
    if (tokenStates.size >= 1_000) for (const [key, entry] of tokenStates) { if (!entry.pending) { tokenStates.delete(key); break; } }
    state = { token: null, pending: null };
    tokenStates.set(namespace, state);
  }
  return state;
}
let lockClientReady: Promise<Client> | null = null;

/**
 * 限流：赛狐是「每个接口 1 请求/秒」，不是全局 1 请求/秒。
 * - 同一 path 严格 ≥ requestSpacingMs（默认 1.1s，留 10% 余量）；
 * - 不同 path 互不阻塞，吞吐 = 并发接口数 × 0.9 rps；
 * - 跨进程用按 path 的 advisory lock（try 轮询，不阻塞连接）。
 * SELLFOX_RATE_LIMIT_MODE=global 可退回旧的全局串行，用于排障。
 */
const rateLimitMode = process.env.SELLFOX_RATE_LIMIT_MODE === "global" ? "global" : "path";
const requestSpacingMs = Math.min(Math.max(Number(process.env.SELLFOX_REQUEST_SPACING_MS) || 1_100, 1_050), 5_000);
const rateLimitWaitMs = Math.min(Math.max(Number(process.env.SELLFOX_RATE_LIMIT_WAIT_MS) || 60_000, 5_000), 300_000);
const globalBucketKey = "sellfox-open-api-global-rate-limit";
const perPathNextAt = new Map<string, number>();
const perPathTail = new Map<string, Promise<void>>();

function rateBucketKey(path: string) {
  return rateLimitMode === "global" ? globalBucketKey : `sellfox-rate:${path}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 同一 path 串行；不同 path 并行。跨进程互斥由 advisory lock 兜底。 */
function scheduleOnPath<T>(path: string, task: () => Promise<T>): Promise<T> {
  if (rateLimitMode === "global") {
    const previous = perPathTail.get(globalBucketKey) ?? Promise.resolve();
    const run = previous.then(task, task);
    perPathTail.set(globalBucketKey, run.then(() => undefined, () => undefined));
    return run;
  }
  const previous = perPathTail.get(path) ?? Promise.resolve();
  const run = previous.then(task, task);
  perPathTail.set(path, run.then(() => undefined, () => undefined));
  return run;
}

type SellfoxEnvelope<T> = { code?: number; msg?: string; data?: T };
type HttpRequest = { url: string; init: RequestInit };

export class SellfoxRequestError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code?: number) {
    super(message);
    this.name = "SellfoxRequestError";
  }
}

async function credentials() {
  try {
    const current = currentSellfoxCredentials();
    if (!current) throw new Error("missing credential scope");
    return await current;
  } catch {
    throw new SellfoxRequestError("赛狐凭据作用域未配置或不可用，未发送请求。", false);
  }
}

const officialErrorText: Record<number, string> = {
  [-1]: "服务异常，请稍后重试",
  40001: "access_token 失效",
  40004: "未查询到开发者信息",
  40005: "访问的客户端 IP 不在白名单",
  40011: "签名错误",
  40012: "重复提交",
  40013: "时间戳失效",
  40014: "参数异常",
  40019: "调用超过限制，请稍后重试",
  40021: "访问的接口暂无权限",
};

function responseError(response: Response, code?: number) {
  // An explicit business error takes precedence over a transient HTTP status.
  // 40012 asks for a new nonce; each attempt already generates one. Never echo upstream msg.
  const retryable = code ? code === 40019 || code === 40012 || code === -1 : response.status === 429 || response.status >= 500;
  const official = code === undefined ? undefined : officialErrorText[code];
  return new SellfoxRequestError(`赛狐接口调用失败（HTTP ${response.status}${code ? ` / ${code}` : ""}${official ? `，${official}` : ""}）。`, retryable, code);
}

async function getAccessToken(credentials: SellfoxResolvedCredentials, state: TokenState) {
  if (state.token && state.token.expiresAt > Date.now()) return state.token.value;
  if (!state.pending) {
    state.pending = (async () => {
      const { clientId, clientSecret } = credentials;
      const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" });
      const { response, payload } = await fetchJsonWithTimeout<{ access_token?: string; expires_in?: number }>(() => ({
        url: `${baseUrl}/api/oauth/v2/token.json?${params}`, init: { cache: "no-store" },
      }), "/api/oauth/v2/token.json");
      if (!response.ok || payload.code) throw responseError(response, payload.code);
      const ttlMs = payload.data?.expires_in;
      const token = payload.data?.access_token;
      if (typeof token !== "string" || !token || typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
        throw new SellfoxRequestError("赛狐 Token 响应缺少有效凭证或毫秒有效期。", false);
      }
      // Sellfox expires_in is milliseconds. Refresh early without extending short TTLs.
      state.token = { value: token, expiresAt: Date.now() + ttlMs - Math.min(60_000, ttlMs * 0.1) };
      return token;
    })();
  }
  const pending = state.pending;
  try { return await pending; }
  finally { if (state.pending === pending) state.pending = null; }
}

/** Explicit administrator connection test: fresh token only, no business API or token response. */
export async function testSellfoxConnection(credentials: SellfoxResolvedCredentials) {
  await getAccessToken(credentials, { token: null, pending: null });
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

async function acquireRateSlot(path: string) {
  if (!process.env.DATABASE_URL) return null;
  const client = await getLockClient();
  const key = rateBucketKey(path);
  const deadline = Date.now() + rateLimitWaitMs;
  while (Date.now() < deadline) {
    const result = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok", [key]);
    if (result.rows[0]?.ok) return { client, key };
    await sleep(120);
  }
  throw new SellfoxRequestError("赛狐限流排队超时，本次请求未发出。", true);
}

async function releaseRateSlot(slot: { client: Client; key: string } | null) {
  if (!slot) return;
  try {
    // 补足间隔再释放：下一个持锁进程至少要等到本次起点 + spacing。
    const waitMs = Math.max(0, (perPathNextAt.get(slot.key) ?? 0) - Date.now());
    if (waitMs) await sleep(waitMs);
    await slot.client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [slot.key]);
  } catch {
    lockClientReady = null;
    await slot.client.end().catch(() => undefined);
  }
}

async function fetchJsonWithTimeout<T>(buildRequest: () => HttpRequest, path: string) {
  return scheduleOnPath(path, async () => {
    const bucket = rateBucketKey(path);
    const waitMs = Math.max(0, (perPathNextAt.get(bucket) ?? 0) - Date.now());
    if (waitMs) await sleep(waitMs);
    const startedAt = Date.now();
    let lockClient: Client | null = null;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let disconnected = false;
    const abortOnDisconnect = () => { disconnected = true; controller.abort(); };
    try {
      if (process.env.DATABASE_URL) {
        const slot = await acquireRateSlot(path);
        if (slot) {
          lockClient = slot.client;
          lockClient.on("error", abortOnDisconnect);
          lockClient.on("end", abortOnDisconnect);
        }
      }
      if (disconnected) throw new SellfoxRequestError("赛狐限流连接已断开，未发送请求。", true);
      // Build timestamp/nonce/sign after waiting for this path's slot.
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
      if (disconnected) throw new SellfoxRequestError("赛狐限流连接已断开，本次请求已停止。", true);
      if (error instanceof Error && error.name === "AbortError") {
        throw new SellfoxRequestError(`赛狐接口请求超时（${Math.round(requestTimeoutMs / 1000)} 秒）。`, true);
      }
      throw new SellfoxRequestError("赛狐接口请求或限流连接暂时失败。", true);
    } finally {
      if (timeout) clearTimeout(timeout);
      perPathNextAt.set(bucket, startedAt + requestSpacingMs);
      if (lockClient) {
        lockClient.removeListener("error", abortOnDisconnect);
        lockClient.removeListener("end", abortOnDisconnect);
        await releaseRateSlot({ client: lockClient, key: bucket });
      }
    }
  });
}

export async function sellfoxPost<T>(path: string, body: unknown, options?: { retry?: boolean }): Promise<T> {
  const resolved = await credentials();
  const { clientId, clientSecret } = resolved;
  const state = tokenState(resolved.namespace);
  let refreshedToken = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const accessToken = await getAccessToken(resolved, state);
      const { response, payload } = await fetchJsonWithTimeout<T>(() => {
        const timestamp = String(Date.now());
        const nonce = String(randomInt(1, 999_999_999));
        const values = { access_token: accessToken, client_id: clientId, method: "post", nonce, timestamp, url: path };
        const signSource = Object.entries(values).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("&");
        const sign = createHmac("sha256", clientSecret).update(signSource).digest("hex");
        const query = new URLSearchParams({ access_token: accessToken, client_id: clientId, timestamp, nonce, sign });
        return { url: `${baseUrl}${path}?${query}`, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" } };
      }, path);
      if (payload.code === 40001) {
        if (state.token?.value === accessToken) state.token = null;
        if (!refreshedToken && attempt < 3) { refreshedToken = true; continue; }
      }
      if (!response.ok || payload.code) throw responseError(response, payload.code);
      return payload.data as T;
    } catch (error) {
      if (options?.retry === false || !(error instanceof SellfoxRequestError) || !error.retryable || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * 2 ** attempt + randomInt(0, 251)));
    }
  }
  throw new SellfoxRequestError("赛狐接口调用超过重试限制。", false);
}

/** Call only after the worker has drained its in-flight jobs. */
export async function closeSellfoxClient() {
  await Promise.all([...perPathTail.values()]);
  const pending = lockClientReady;
  lockClientReady = null;
  if (pending) await pending.then(client => client.end()).catch(() => undefined);
  tokenStates.clear();
}
