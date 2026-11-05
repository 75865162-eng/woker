export type AdsRegion = "NA" | "EU" | "FE";

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

export function createAmazonAdsOAuthTransport(fetcher: typeof fetch = fetch): AmazonAdsOAuthTransport {
  return {
    async exchangeAuthorizationCode(input) {
      const response = await fetcher(lwaTokenHosts[input.region], {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri, client_id: input.clientId, client_secret: input.clientSecret }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error("Amazon Ads OAuth token exchange failed.");
      const payload = await response.json() as Record<string, unknown>;
      if (typeof payload.refresh_token !== "string" || !payload.refresh_token || typeof payload.access_token !== "string" || !payload.access_token) throw new Error("Amazon Ads OAuth token response is incomplete.");
      return { refreshToken: payload.refresh_token, accessToken: payload.access_token };
    },
    async refreshAccessToken(input) {
      const response = await fetcher(lwaTokenHosts[input.region], {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: input.refreshToken, client_id: input.clientId, client_secret: input.clientSecret }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error("Amazon Ads access token refresh failed.");
      const payload = await response.json() as Record<string, unknown>;
      if (typeof payload.access_token !== "string" || !payload.access_token) throw new Error("Amazon Ads token refresh response is incomplete.");
      return payload.access_token;
    },
    async listProfiles(input) {
      const response = await fetcher(`${adsRegionHosts[input.region]}/v2/profiles`, {
        headers: { "Amazon-Advertising-API-ClientId": input.clientId, Authorization: `Bearer ${input.accessToken}` },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error("Amazon Ads Profile discovery failed.");
      return parseAmazonAdsProfiles(await response.json());
    },
  };
}
