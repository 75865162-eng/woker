import { assertAmazonCloudExecution } from "@/lib/amazon/execution-role";
import { AdsSyncError } from "./sync-policy";

export type AdsRegion = "NA" | "EU" | "FE";

type OAuthOperation = "EXCHANGE" | "REFRESH" | "PROFILES";
/** Only locally constructed metadata is exposed; never include an upstream body or URL. */
export class AmazonAdsConnectionError extends AdsSyncError {
  constructor(readonly operation: OAuthOperation, readonly region: AdsRegion, reason: string, readonly httpStatus?: number, retryAfterMs = 0) {
    super(`ADS_CONNECTION_${operation}_${reason}`, reason === "NETWORK" || reason === "TIMEOUT" || httpStatus === 429 || (httpStatus !== undefined && httpStatus >= 500), retryAfterMs);
    this.message = `Amazon Ads ${region} ${operation} 连接未完成（${this.code}）。请检查区域、授权及服务端配置。`;
  }
}

export const adsRegionHosts: Record<AdsRegion, string> = {
  NA: "https://advertising-api.amazon.com",
  EU: "https://advertising-api-eu.amazon.com",
  FE: "https://advertising-api-fe.amazon.com",
};
export const lwaTokenHosts: Record<AdsRegion, string> = {
  NA: "https://api.amazon.com/auth/o2/token",
  EU: "https://api.amazon.co.uk/auth/o2/token",
  FE: "https://api.amazon.co.jp/auth/o2/token",
};
export const lwaConsentHosts: Record<AdsRegion, string> = {
  NA: "https://www.amazon.com/ap/oa",
  EU: "https://eu.account.amazon.com/ap/oa",
  FE: "https://apac.account.amazon.com/ap/oa",
};

export interface AmazonAdsProfilePayload {
  profileId: string | number;
  countryCode: string;
  currencyCode?: string;
  timezone?: string;
  accountInfo?: {
    marketplaceStringId?: string;
    id?: string;
    type?: string;
    name?: string;
    validPaymentMethod?: boolean;
  };
}

export interface AmazonAdsOAuthTransport {
  exchangeAuthorizationCode(input: { region: AdsRegion; code: string; redirectUri: string; clientId: string; clientSecret: string }): Promise<{ refreshToken: string; accessToken: string }>;
  refreshAccessToken(input: { region: AdsRegion; refreshToken: string; clientId: string; clientSecret: string }): Promise<string>;
  listProfiles(input: { region: AdsRegion; clientId: string; accessToken: string }): Promise<AmazonAdsProfilePayload[]>;
}

export function parseAmazonAdsProfiles(value: unknown): AmazonAdsProfilePayload[] {
  if (!Array.isArray(value) || value.length > 5000) throw new Error("Amazon Ads Profile 响应无效。");
  const rows = value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Amazon Ads Profile 响应无效。");
    const row = raw as Record<string, unknown>;
    const accountInfo = row.accountInfo && typeof row.accountInfo === "object" && !Array.isArray(row.accountInfo)
      ? row.accountInfo as Record<string, unknown>
      : {};
    if (typeof row.profileId === "number" && (!Number.isSafeInteger(row.profileId) || row.profileId < 0)) throw new Error("Amazon Ads Profile 数字 ID 超出安全精度，不能保存可能失真的身份。");
    const profileId = typeof row.profileId === "number" ? String(row.profileId) : row.profileId;
    if (typeof profileId !== "string" || !/^\d{1,30}$/.test(profileId) || typeof row.countryCode !== "string" || !/^[A-Z]{2}$/.test(row.countryCode)) {
      throw new Error("Amazon Ads Profile 缺少有效身份字段。");
    }
    for (const field of ["currencyCode", "timezone"] as const) if (row[field] !== undefined && typeof row[field] !== "string") throw new Error("Amazon Ads Profile 字段无效。");
    for (const field of ["marketplaceStringId", "id", "type", "name"] as const) if (accountInfo[field] !== undefined && typeof accountInfo[field] !== "string") throw new Error("Amazon Ads 账户信息无效。");
    return {
      profileId,
      countryCode: row.countryCode,
      ...(typeof row.currencyCode === "string" ? { currencyCode: row.currencyCode } : {}),
      ...(typeof row.timezone === "string" ? { timezone: row.timezone } : {}),
      accountInfo: {
        ...(typeof accountInfo.marketplaceStringId === "string" ? { marketplaceStringId: accountInfo.marketplaceStringId } : {}),
        ...(typeof accountInfo.id === "string" ? { id: accountInfo.id } : {}),
        ...(typeof accountInfo.type === "string" ? { type: accountInfo.type } : {}),
        ...(typeof accountInfo.name === "string" ? { name: accountInfo.name } : {}),
        ...(typeof accountInfo.validPaymentMethod === "boolean" ? { validPaymentMethod: accountInfo.validPaymentMethod } : {}),
      },
    } satisfies AmazonAdsProfilePayload;
  });
  if (new Set(rows.map((row) => row.profileId)).size !== rows.length) throw new Error("Amazon Ads Profile 响应包含重复 ID。");
  return rows;
}

function retryAfter(value: string | null): number {
  if (!value) return 0;
  const delay = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isSafeInteger(delay) && delay > 0 ? delay : 0;
}

export function createAmazonAdsOAuthTransport(fetcher: typeof fetch = fetch): AmazonAdsOAuthTransport {
  async function request(operation: OAuthOperation, region: AdsRegion, url: string, init: RequestInit): Promise<unknown> {
    if (!Object.hasOwn(adsRegionHosts, region)) throw new AdsSyncError("ADS_REGION_INVALID");
    assertAmazonCloudExecution();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const fail = (reason: string, status?: number, delay = 0) => new AmazonAdsConnectionError(operation, region, reason, status, delay);
    const work = async () => {
      let response: Response;
      try { response = await fetcher(url, { ...init, cache: "no-store", redirect: "error", signal: controller.signal }); }
      catch { throw fail(controller.signal.aborted ? "TIMEOUT" : "NETWORK"); }
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw fail("TIMEOUT");
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw fail(`HTTP_${response.status}`, response.status, retryAfter(response.headers.get("retry-after")));
      }
      // Local response ceilings, not Amazon quotas. Tokens are never included in errors.
      const maxBytes = operation === "PROFILES" ? 4 * 1024 * 1024 : 64 * 1024;
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
        void response.body?.cancel().catch(() => {});
        throw fail("RESPONSE_LIMIT");
      }
      if (!response.body) throw fail("RESPONSE_INVALID");
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (controller.signal.aborted) throw fail("TIMEOUT");
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maxBytes) throw fail("RESPONSE_LIMIT");
          chunks.push(chunk.value);
        }
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size))) as unknown;
      } catch (error) {
        if (error instanceof AmazonAdsConnectionError) throw error;
        throw fail("RESPONSE_INVALID");
      } finally {
        void reader.cancel().catch(() => {});
      }
    };
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        void reader?.cancel().catch(() => {});
        reject(fail("TIMEOUT"));
      }, 20000);
    });
    try { return await Promise.race([work(), deadline]); }
    finally { clearTimeout(timer); }
  }
  const token = (value: unknown, field: string, operation: OAuthOperation, region: AdsRegion): string => {
    const result = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[field] : undefined;
    if (typeof result !== "string" || !result || /[\u0000-\u0020\u007f]/.test(result)) throw new AmazonAdsConnectionError(operation, region, "RESPONSE_INVALID");
    return result;
  };
  return {
    async exchangeAuthorizationCode(input) {
      const payload = await request("EXCHANGE", input.region, lwaTokenHosts[input.region], {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri, client_id: input.clientId, client_secret: input.clientSecret }),
      });
      return { refreshToken: token(payload, "refresh_token", "EXCHANGE", input.region), accessToken: token(payload, "access_token", "EXCHANGE", input.region) };
    },
    async refreshAccessToken(input) {
      const payload = await request("REFRESH", input.region, lwaTokenHosts[input.region], {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: input.refreshToken, client_id: input.clientId, client_secret: input.clientSecret }),
      });
      return token(payload, "access_token", "REFRESH", input.region);
    },
    async listProfiles(input) {
      const payload = await request("PROFILES", input.region, `${adsRegionHosts[input.region]}/v2/profiles`, {
        headers: { "Amazon-Advertising-API-ClientId": input.clientId, Authorization: `Bearer ${input.accessToken}` },
      });
      try { return parseAmazonAdsProfiles(payload); }
      catch { throw new AmazonAdsConnectionError("PROFILES", input.region, "RESPONSE_INVALID"); }
    },
  };
}
