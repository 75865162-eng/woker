import { createHash, createHmac } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { AmazonSpApiServerConfiguration } from "./sp-api-config";

const lwaTokenUrl = "https://api.amazon.com/auth/o2/token";
const signingService = "execute-api";
const tokenRefreshSkewMs = 60_000;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type AmazonSpApiClientOptions = {
  fetch?: FetchLike;
  now?: () => Date;
  requestTimeoutMs?: number;
  onResponse?: (event: AmazonRequestEvent) => void;
};

export type AmazonRequestEvent = { operation: string; status: number | null; requestId: string | null; rateLimit: string | null };

export class AmazonSpApiError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number;
  readonly authorizationRejected: boolean;

  constructor(message: string, options: { status?: number | null; retryable?: boolean; retryAfterMs?: number; authorizationRejected?: boolean } = {}) {
    super(message);
    this.name = "AmazonSpApiError";
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? 0;
    this.authorizationRejected = options.authorizationRejected ?? (this.status === 401 || this.status === 403);
  }
}

export class AmazonSpApiClient {
  private readonly fetcher: FetchLike;
  private readonly now: () => Date;
  private readonly requestTimeoutMs: number;
  private readonly onResponse?: (event: AmazonRequestEvent) => void;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: AmazonSpApiServerConfiguration,
    options: AmazonSpApiClientOptions = {},
  ) {
    this.fetcher = options.fetch ?? fetch;
    this.onResponse = options.onResponse;
    this.now = options.now ?? (() => new Date());
    this.requestTimeoutMs = Math.min(Math.max(options.requestTimeoutMs ?? 30_000, 5_000), 120_000);
  }

  async getMarketplaceParticipations(): Promise<unknown> {
    return this.request("GET", "/sellers/v1/marketplaceParticipations");
  }

  async searchListingsItems(input: { sellerId: string; marketplaceId: string; nextToken?: string }): Promise<unknown> {
    const query = new URLSearchParams({ marketplaceIds: input.marketplaceId, includedData: "summaries,fulfillmentAvailability", pageSize: "20" });
    if (input.nextToken) query.set("pageToken", input.nextToken);
    return this.request("GET", `/listings/2021-08-01/items/${encodeURIComponent(input.sellerId)}?${query}`);
  }

  async getInventorySummaries(input: { marketplaceId: string; nextToken?: string }): Promise<unknown> {
    const query = new URLSearchParams({
      granularityType: "Marketplace",
      granularityId: input.marketplaceId,
      marketplaceIds: input.marketplaceId,
      details: "true",
    });
    if (input.nextToken) query.set("nextToken", input.nextToken);
    return this.request("GET", `/fba/inventory/v1/summaries?${query.toString()}`);
  }

  async createSalesTrafficReport(input: { marketplaceId: string; startAt: string; endExclusive: string; reportEndAt?: string }): Promise<unknown> {
    return this.request("POST", "/reports/2021-06-30/reports", {
      reportType: "GET_SALES_AND_TRAFFIC_REPORT", marketplaceIds: [input.marketplaceId],
      dataStartTime: input.startAt, dataEndTime: input.reportEndAt ?? new Date(Date.parse(input.endExclusive) - 1000).toISOString(),
      reportOptions: { dateGranularity: "DAY", asinGranularity: "CHILD" },
    });
  }
  async getReport(reportId: string): Promise<unknown> {
    return this.request("GET", `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`);
  }
  async getReportDocument(documentId: string): Promise<unknown> {
    return this.request("GET", `/reports/2021-06-30/documents/${encodeURIComponent(documentId)}`);
  }
  /** Presigned S3 downloads never receive LWA/AWS headers and never follow redirects. */
  async downloadReportDocument(value: unknown): Promise<unknown> {
    const document = value as { url?: unknown; compressionAlgorithm?: unknown } | null;
    if (!document || typeof document.url !== "string") throw new AmazonSpApiError("报告下载地址缺失。");
    const url = new URL(document.url);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || !/^(?:[a-z0-9.-]+\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com(?:\.cn)?$/.test(url.hostname)) throw new AmazonSpApiError("报告下载地址不在允许的 S3 HTTPS 范围。");
    if (document.compressionAlgorithm !== undefined && document.compressionAlgorithm !== "GZIP") throw new AmazonSpApiError("报告压缩格式不支持。");
    const limit = 16 * 1024 * 1024;
    try {
      const response = await this.fetcher(url.toString(), { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(this.requestTimeoutMs) });
      this.onResponse?.({ operation: "downloadReportDocument", status: response.status, requestId: null, rateLimit: null });
      if (!response.ok) { await response.body?.cancel(); throw new AmazonSpApiError("报告下载失败。", { status: response.status, retryable: response.status === 429 || response.status >= 500 }); }
      if (!response.body || Number(response.headers.get("content-length") ?? 0) > limit) { await response.body?.cancel(); throw new AmazonSpApiError("报告超过下载大小限制。"); }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
      try {
        while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > limit) { await reader.cancel(); throw new AmazonSpApiError("报告超过下载大小限制。"); } chunks.push(part.value); }
      } finally { reader.releaseLock(); }
      const data = Buffer.concat(chunks);
      const decoded = document.compressionAlgorithm === "GZIP" ? gunzipSync(data, { maxOutputLength: limit }) : data;
      try { return JSON.parse(decoded.toString("utf8")); } catch { throw new AmazonSpApiError("报告不是有效 JSON。"); }
    } catch (error) {
      if (error instanceof AmazonSpApiError) throw error;
      // Signed URLs and upstream exception text must never reach logs or responses.
      throw new AmazonSpApiError("报告下载或解压失败。", { retryable: true });
    }
  }

  async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const accessToken = await this.getAccessToken();
    const url = new URL(path, this.config.endpoint);
    if (url.origin !== this.config.endpoint || !url.pathname.startsWith("/")) {
      throw new AmazonSpApiError("SP-API 请求路径无效。");
    }

    const requestBody = body === undefined ? undefined : JSON.stringify(body);
    const timestamp = this.now();
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-access-token": accessToken,
      "x-amz-date": formatAmzDate(timestamp),
    };
    if (requestBody !== undefined) headers["content-type"] = "application/json";
    if (this.config.awsAccessKeyId && this.config.awsSecretAccessKey && this.config.awsSessionToken) headers["x-amz-security-token"] = this.config.awsSessionToken;

    // Legacy configurations can still sign; current SP-API only requires the LWA token.
    if (this.config.awsAccessKeyId && this.config.awsSecretAccessKey) headers.authorization = createAuthorizationHeader({
      method,
      url,
      headers,
      body: requestBody ?? "",
      config: this.config,
      now: timestamp,
    });

    const response = await this.fetchWithTimeout(url.toString(), {
      method,
      headers,
      body: requestBody,
      cache: "no-store",
      redirect: "error",
    });
    const text = await response.text();
    const payload = parseResponseBody(text);
    if (!response.ok) {
      throw new AmazonSpApiError(safeAmazonErrorMessage(response.status, payload, this.secretValues(accessToken)), {
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
        retryAfterMs: readRetryAfter(response.headers.get("retry-after"), this.now()),
      });
    }
    return payload;
  }

  private async getAccessToken(): Promise<string> {
    const nowMs = this.now().getTime();
    if (this.token && this.token.expiresAt > nowMs + tokenRefreshSkewMs) return this.token.value;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.config.refreshToken,
      client_id: this.config.lwaClientId,
      client_secret: this.config.lwaClientSecret,
    });
    const response = await this.fetchWithTimeout(lwaTokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
      cache: "no-store",
    });
    const payload = parseResponseBody(await response.text());
    if (!response.ok || !isAccessTokenPayload(payload)) {
      const oauthError = payload && typeof payload === "object" ? (payload as Record<string, unknown>).error : undefined;
      throw new AmazonSpApiError(safeAmazonErrorMessage(response.status, payload, this.secretValues()), {
        status: response.status,
        authorizationRejected: response.status === 401 || response.status === 403 || (response.status === 400 && ["invalid_grant", "invalid_client", "unauthorized_client"].includes(String(oauthError))),
        retryable: response.status === 429 || response.status >= 500,
        retryAfterMs: readRetryAfter(response.headers.get("retry-after"), this.now()),
      });
    }
    this.token = {
      value: payload.access_token,
      expiresAt: nowMs + payload.expires_in * 1000,
    };
    return this.token.value;
  }

  private async fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetcher(input, { ...init, signal: controller.signal });
      this.onResponse?.({ operation: input === lwaTokenUrl ? "LWA" : input.includes("/fba/inventory/") ? "getInventorySummaries" : input.includes("/listings/") ? "searchListingsItems" : input.includes("/reports/2021-06-30/documents/") ? "getReportDocument" : input.includes("/reports/2021-06-30/reports/") ? "getReport" : input.includes("/reports/2021-06-30/reports") ? "createReport" : "getMarketplaceParticipations", status: response.status,
        requestId: safeRequestId(response.headers.get("x-amzn-requestid")), rateLimit: safeRateLimit(response.headers.get("x-amzn-ratelimit-limit")) });
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AmazonSpApiError(`Amazon SP-API 请求超时（${Math.round(this.requestTimeoutMs / 1000)} 秒）。`, { retryable: true });
      }
      throw new AmazonSpApiError("Amazon SP-API 网络请求失败。", { retryable: true });
    } finally {
      clearTimeout(timeout);
    }
  }

  private secretValues(accessToken?: string): string[] {
    return [
      this.config.lwaClientId,
      this.config.lwaClientSecret,
      this.config.refreshToken,
      this.config.awsAccessKeyId,
      this.config.awsSecretAccessKey,
      this.config.awsSessionToken,
      accessToken,
    ].filter((value): value is string => Boolean(value));
  }
}

function createAuthorizationHeader(input: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string;
  config: AmazonSpApiServerConfiguration;
  now: Date;
}): string {
  const sortedHeaders = Object.entries(input.headers)
    .filter(([name]) => name !== "authorization")
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const canonicalHeaders = sortedHeaders.map(([name, value]) => `${name}:${value}\n`).join("");
  const signedHeaders = sortedHeaders.map(([name]) => name).join(";");
  const credentialDate = formatAmzDate(input.now).slice(0, 8);
  const credentialScope = `${credentialDate}/${input.config.region}/${signingService}/aws4_request`;
  const canonicalRequest = [
    input.method,
    encodePath(input.url.pathname),
    canonicalQuery(input.url.searchParams),
    canonicalHeaders,
    signedHeaders,
    sha256(input.body),
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", formatAmzDate(input.now), credentialScope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.config.awsSecretAccessKey}`, credentialDate), input.config.region), signingService),
    "aws4_request",
  );
  const signature = hmac(signingKey, stringToSign, "hex");
  return `AWS4-HMAC-SHA256 Credential=${input.config.awsAccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function hmac(key: string | Buffer, value: string, encoding?: "hex"): Buffer | string {
  const result = createHmac("sha256", key).update(value).digest();
  return encoding === "hex" ? result.toString("hex") : result;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function formatAmzDate(value: Date): string {
  return value.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function canonicalQuery(search: URLSearchParams): string {
  return [...search.entries()]
    .map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function encodePath(path: string): string {
  return path.split("/").map(awsEncode).join("/") || "/";
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function parseResponseBody(value: string): unknown {
  if (!value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { message: value.slice(0, 500) };
  }
}

function isAccessTokenPayload(value: unknown): value is { access_token: string; expires_in: number } {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as Record<string, unknown>).access_token === "string"
    && Boolean(((value as Record<string, unknown>).access_token as string).trim())
    && typeof (value as Record<string, unknown>).expires_in === "number"
    && Number.isFinite((value as Record<string, unknown>).expires_in)
    && ((value as Record<string, unknown>).expires_in as number) > 0;
}

function safeAmazonErrorMessage(status: number, payload: unknown, secretValues: string[]): string {
  const rawMessage = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).message ?? (payload as Record<string, unknown>).error_description ?? (payload as Record<string, unknown>).error
    : null;
  const message = typeof rawMessage === "string"
    ? redactAmazonErrorMessage(rawMessage, secretValues)
    : "请求被 Amazon 拒绝。";
  return `Amazon SP-API 请求失败 (${status})：${message}`;
}

function redactAmazonErrorMessage(message: string, secretValues: string[]): string {
  let redacted = message.replace(/[\r\n]+/g, " ");
  for (const value of secretValues) {
    if (value.length >= 3) redacted = redacted.split(value).join("[REDACTED]");
  }
  return redacted
    .replace(/(authorization|access_token|refresh_token|client_secret)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 300);
}

export function readRetryAfter(value: string | null, now: Date): number {
  if (!value) return 0;
  const milliseconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now.getTime();
  return Number.isFinite(milliseconds) ? Math.max(0, Math.min(milliseconds, 3600000)) : 0;
}
function safeRequestId(value: string | null) { return value && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : null; }
function safeRateLimit(value: string | null) { return value && /^\d+(?:\.\d+)?$/.test(value) && value.length < 20 ? value : null; }
