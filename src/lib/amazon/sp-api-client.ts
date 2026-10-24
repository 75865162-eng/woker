import { createHash, createHmac } from "node:crypto";
import type { AmazonSpApiServerConfiguration } from "./sp-api-config";

const lwaTokenUrl = "https://api.amazon.com/auth/o2/token";
const signingService = "execute-api";
const tokenRefreshSkewMs = 60_000;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type AmazonSpApiClientOptions = {
  fetch?: FetchLike;
  now?: () => Date;
  requestTimeoutMs?: number;
};

export class AmazonSpApiError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number | null; retryable?: boolean } = {}) {
    super(message);
    this.name = "AmazonSpApiError";
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

export class AmazonSpApiClient {
  private readonly fetcher: FetchLike;
  private readonly now: () => Date;
  private readonly requestTimeoutMs: number;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: AmazonSpApiServerConfiguration,
    options: AmazonSpApiClientOptions = {},
  ) {
    this.fetcher = options.fetch ?? fetch;
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
    });
    const text = await response.text();
    const payload = parseResponseBody(text);
    if (!response.ok) {
      throw new AmazonSpApiError(safeAmazonErrorMessage(response.status, payload, this.secretValues(accessToken)), {
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
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
      throw new AmazonSpApiError(safeAmazonErrorMessage(response.status, payload, this.secretValues()), {
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    this.token = {
      value: payload.access_token,
      expiresAt: nowMs + Math.max(payload.expires_in * 1000, tokenRefreshSkewMs * 2),
    };
    return this.token.value;
  }

  private async fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetcher(input, { ...init, signal: controller.signal });
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
    && typeof (value as Record<string, unknown>).expires_in === "number";
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
