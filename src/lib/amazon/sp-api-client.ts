import { createHash, createHmac } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { AmazonSpApiServerConfiguration } from "./sp-api-config";

const lwaTokenUrl = "https://api.amazon.com/auth/o2/token";
const signingService = "execute-api";
const tokenRefreshSkewMs = 5 * 60_000;
const userAgent = "amazon-ad-bulk-operation/1.0 (Language=TypeScript/5)";

const inboundReadPath = "/inbound/fba/2024-03-20/inboundPlans";
function inboundPathId(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value)) throw new AmazonSpApiError("FBA 在途读取标识无效。");
  return encodeURIComponent(value);
}
function inboundPageQuery(token?: string): string {
  const query = new URLSearchParams({ pageSize: "10" });
  if (token !== undefined) {
    if (typeof token !== "string" || !token.trim() || token.length > 4096 || /[\u0000-\u001f\u007f]/.test(token)) throw new AmazonSpApiError("FBA 在途分页标识无效。");
    query.set("paginationToken", token);
  }
  return query.toString();
}
function inboundRequestOperation(url: string): string | undefined {
  const path = new URL(url).pathname;
  if (path === inboundReadPath) return "listInboundPlans";
  if (!path.startsWith(inboundReadPath + "/")) return undefined;
  const parts = path.slice(inboundReadPath.length + 1).split("/");
  if (parts.length === 1) return "getInboundPlan";
  if (parts.length === 2 && parts[1] === "items") return "listInboundPlanItems";
  if (parts.length === 3 && parts[1] === "shipments") return "getShipment";
  if (parts.length === 4 && parts[1] === "shipments" && parts[3] === "items") return "listShipmentItems";
  return undefined;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type AmazonSpApiClientOptions = {
  fetch?: FetchLike;
  now?: () => Date;
  requestTimeoutMs?: number;
  onResponse?: (event: AmazonRequestEvent) => void;
  /** Local mock transport only; production always uses the registered LWA URL. */
  tokenEndpoint?: string;
  /** Tenant/authorization/revision namespace; shared only by trusted server callers. */
  cacheScope?: string;
  /** Injected offline fetch only; never a production host allowlist. */
  reportDownloadTestHost?: string;
};

export type AmazonRequestEvent = { operation: string; status: number | null; requestId: string | null; rateLimit: string | null };
type AccessTokenState = { token: { value: string; expiresAt: number } | null; refreshInFlight: Promise<string> | null };
const sharedAccessTokens = new Map<string, AccessTokenState>();

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
  private readonly tokenState: AccessTokenState;
  private readonly tokenEndpoint: string;
  private readonly reportDownloadTestHost?: string;

  constructor(
    private readonly config: AmazonSpApiServerConfiguration,
    options: AmazonSpApiClientOptions = {},
  ) {
    this.fetcher = options.fetch ?? fetch;
    if (options.tokenEndpoint && (!options.fetch || !new URL(options.tokenEndpoint).hostname.endsWith(".invalid"))) throw new Error("测试 token 端点须使用隔离 transport 和 .invalid 域名。");
    this.tokenEndpoint = options.tokenEndpoint ?? lwaTokenUrl;
    if (options.reportDownloadTestHost && (!options.fetch || !/^[a-z0-9.-]+\.invalid$/.test(options.reportDownloadTestHost))) throw new Error("测试报告下载主机须为隔离 transport 和 .invalid 域名。");
    this.reportDownloadTestHost = options.reportDownloadTestHost;
    this.onResponse = options.onResponse;
    this.now = options.now ?? (() => new Date());
    this.tokenState = { token: null, refreshInFlight: null };
    if (options.cacheScope) {
      // A credential rotation cannot accidentally reuse a former token. Digests,
      // tokens and refresh promises stay in memory and are never serialized.
      const key = createHash("sha256").update(JSON.stringify([options.cacheScope, config.endpoint, this.tokenEndpoint, config.lwaClientId, config.lwaClientSecret, config.refreshToken])).digest("hex");
      const existing = sharedAccessTokens.get(key);
      if (existing) this.tokenState = existing;
      else {
        // Do not evict an expired state still referenced by a live client: doing
        // so would create two refresh locks for the same authorization.
        if (sharedAccessTokens.size >= 1000) throw new Error("订单授权缓存达到安全容量，请受控重启 Worker 后重试。");
        sharedAccessTokens.set(key, this.tokenState);
      }
    }
    this.requestTimeoutMs = Math.min(Math.max(options.requestTimeoutMs ?? 30_000, 5_000), 120_000);
  }

  async getMarketplaceParticipations(): Promise<unknown> {
    return this.request("GET", "/sellers/v1/marketplaceParticipations");
  }

  async getListingDetail(input: { sellerId: string; sellerSku: string; marketplaceId: string }): Promise<{ body: unknown; rawBody: string }> {
    if (!input.sellerId || input.sellerId.length > 200 || !input.sellerSku.trim() || input.sellerSku.length > 255 || /[\u0000-\u001f\u007f]/.test(input.sellerSku)) throw new AmazonSpApiError("Listing 详情范围无效。");
    const query = new URLSearchParams({ marketplaceIds: input.marketplaceId, includedData: "summaries,attributes,relationships,productTypes" });
    let rawBody = "";
    const body = await this.request("GET", `/listings/2021-08-01/items/${encodeURIComponent(input.sellerId)}/${encodeURIComponent(input.sellerSku)}?${query}`, undefined, text => { rawBody = text; });
    return { body, rawBody };
  }
  async getCatalogDetail(input: { asin: string; marketplaceId: string }): Promise<{ body: unknown; rawBody: string }> {
    if (!/^[A-Z0-9]{10}$/.test(input.asin)) throw new AmazonSpApiError("目录详情 ASIN 无效。");
    const query = new URLSearchParams({ marketplaceIds: input.marketplaceId, includedData: "summaries,attributes,classifications,images,identifiers,productTypes,relationships,dimensions" });
    let rawBody = "";
    const body = await this.request("GET", `/catalog/2022-04-01/items/${input.asin}?${query}`, undefined, text => { rawBody = text; });
    return { body, rawBody };
  }

  async searchListingsItems(input: { sellerId: string; marketplaceId: string; nextToken?: string }): Promise<unknown> {
    const query = new URLSearchParams({ marketplaceIds: input.marketplaceId, includedData: "summaries,fulfillmentAvailability", pageSize: "20" });
    if (input.nextToken) query.set("pageToken", input.nextToken);
    return this.request("GET", `/listings/2021-08-01/items/${encodeURIComponent(input.sellerId)}?${query}`);
  }

  /** Read-only inbound candidates; adding client methods does not enable the
   * fulfillment resource. Raw address/contact payloads must remain encrypted.
   * No marketplace filter is invented for a seller-scoped upstream operation.
   */
  async getOwnPrices(input: { asins: string[]; marketplaceId: string }): Promise<{ body: unknown; rawBody: string }> {
    if (!input.asins.length || input.asins.length > 20 || input.asins.some(asin => !/^[A-Z0-9]{10}$/.test(asin)) || new Set(input.asins).size !== input.asins.length) throw new AmazonSpApiError("价格请求 ASIN 范围无效。");
    const query = new URLSearchParams({ MarketplaceId: input.marketplaceId, Asins: input.asins.join(","), ItemType: "Asin", ItemCondition: "New", OfferType: "B2C" });
    let rawBody = "";
    const body = await this.request("GET", `/products/pricing/v0/price?${query}`, undefined, text => { rawBody = text; });
    return { body, rawBody };
  }
  async getCompetitiveSummary(input: { asins: string[]; marketplaceId: string }): Promise<{ body: unknown; rawBody: string }> {
    if (!input.asins.length || input.asins.length > 20 || input.asins.some(asin => !/^[A-Z0-9]{10}$/.test(asin)) || new Set(input.asins).size !== input.asins.length) throw new AmazonSpApiError("价格请求 ASIN 范围无效。");
    let rawBody = "";
    const body = await this.request("POST", "/batches/products/pricing/2022-05-01/items/competitiveSummary", { requests: input.asins.map(asin => ({ asin, marketplaceId: input.marketplaceId, includedData: ["featuredBuyingOptions", "referencePrices"], method: "GET", uri: "/products/pricing/2022-05-01/items/competitiveSummary" })) }, text => { rawBody = text; });
    return { body, rawBody };
  }
  async createObservationReport(input: { reportType: string; marketplaceIds: string[]; dataStartTime: string; dataEndTime: string; reportOptions: Record<string, string> }): Promise<unknown> {
    if (!["GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT", "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT", "GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT", "GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT", "GET_SALES_AND_TRAFFIC_REPORT"].includes(input.reportType) || input.marketplaceIds.length !== 1) throw new AmazonSpApiError("报告请求类型或站点范围无效。");
    return this.request("POST", "/reports/2021-06-30/reports", input);
  }
  async listInboundPlans(input: { paginationToken?: string } = {}): Promise<{ body: unknown; rawBody: string }> {
    return this.readInbound(`${inboundReadPath}?${inboundPageQuery(input.paginationToken)}`);
  }

  async getInboundPlan(input: { inboundPlanId: string }): Promise<{ body: unknown; rawBody: string }> {
    return this.readInbound(`${inboundReadPath}/${inboundPathId(input.inboundPlanId)}`);
  }

  async listInboundPlanItems(input: { inboundPlanId: string; paginationToken?: string }): Promise<{ body: unknown; rawBody: string }> {
    return this.readInbound(`${inboundReadPath}/${inboundPathId(input.inboundPlanId)}/items?${inboundPageQuery(input.paginationToken)}`);
  }

  async getInboundShipment(input: { inboundPlanId: string; shipmentId: string }): Promise<{ body: unknown; rawBody: string }> {
    return this.readInbound(`${inboundReadPath}/${inboundPathId(input.inboundPlanId)}/shipments/${inboundPathId(input.shipmentId)}`);
  }

  async listInboundShipmentItems(input: { inboundPlanId: string; shipmentId: string; paginationToken?: string }): Promise<{ body: unknown; rawBody: string }> {
    return this.readInbound(`${inboundReadPath}/${inboundPathId(input.inboundPlanId)}/shipments/${inboundPathId(input.shipmentId)}/items?${inboundPageQuery(input.paginationToken)}`);
  }

  private async readInbound(path: string): Promise<{ body: unknown; rawBody: string }> {
    let rawBody = "";
    const body = await this.request("GET", path, undefined, text => { rawBody = text; });
    return { body, rawBody };
  }

  /** Orders API 2026-01-01, searchOrders. FULFILLMENT may include gift-message PII;
   * callers must encrypt the complete raw response, including basic item data.
   * https://developer-docs.amazon.com/sp-api/reference/searchorders
   * https://github.com/amzn/selling-partner-api-models/blob/main/models/orders-api-model/orders_2026-01-01.json
   * Response nextToken becomes query paginationToken (never v0 NextToken).
   */
  async searchOrders(input: { marketplaceId: string; lastUpdatedAfter: string; lastUpdatedBefore: string; paginationToken?: string }): Promise<{ body: unknown; rawBody: string }> {
    const query = new URLSearchParams({ marketplaceIds: input.marketplaceId, lastUpdatedAfter: input.lastUpdatedAfter, lastUpdatedBefore: input.lastUpdatedBefore, maxResultsPerPage: "100", includedData: "FULFILLMENT" });
    if (input.paginationToken) query.set("paginationToken", input.paginationToken);
    let rawBody = "";
    const body = await this.request("GET", `/orders/2026-01-01/orders?${query}`, undefined, text => { rawBody = text; });
    return { body, rawBody };
  }

  /** Orders v2026-01-01 getOrder (LWA, approved roles; no Orders RDT).
   * https://developer-docs.amazon.com/sp-api/reference/getorder-3
   * https://developer-docs.amazon.com/sp-api/docs/access-orders-pii
   * Dataset selection and identity/role checks belong to the existing service.
   */
  async getOrder(input: { orderId: string; includedData: readonly string[] }): Promise<{ body: unknown; rawBody: string }> {
    const query = new URLSearchParams();
    if (input.includedData.length) query.set("includedData", input.includedData.join(","));
    let rawBody = "";
    const body = await this.request("GET", `/orders/2026-01-01/orders/${encodeURIComponent(input.orderId)}${query.size ? `?${query}` : ""}`, undefined, text => { rawBody = text; });
    return { body, rawBody };
  }

  /** Finances v2024-06-19 listTransactions. Explicit seller-wide approval is
   * enforced by the service; marketplaceId is omitted (required for US MFN).
   * https://developer-docs.amazon.com/sp-api/reference/listtransactions
   * https://developer-docs.amazon.com/sp-api/docs/finances-api-v2024-06-19-reference
   * Return original wire JSON, not a JS-number parsed body: currencyAmount is
   * BigDecimal/JSON number and must be decoded losslessly by finance.ts.
   */
  async listTransactions(input: { postedAfter: string; postedBefore: string; nextToken?: string }): Promise<{ rawBody: string }> {
    const query = new URLSearchParams({ postedAfter: input.postedAfter, postedBefore: input.postedBefore });
    if (input.nextToken) query.set("nextToken", input.nextToken);
    let rawBody = "";
    await this.request("GET", `/finances/2024-06-19/transactions?${query}`, undefined, text => { rawBody = text; }, true);
    return { rawBody };
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

  async createSalesTrafficReport(input: { marketplaceId: string; startAt: string; endExclusive: string; reportEndAt?: string; from?: string; to?: string }): Promise<unknown> {
    return this.request("POST", "/reports/2021-06-30/reports", {
      reportType: "GET_SALES_AND_TRAFFIC_REPORT", marketplaceIds: [input.marketplaceId],
      // DAY reports normalize timestamps to UTC calendar dates.
      dataStartTime: input.from ? `${input.from}T00:00:00Z` : input.startAt,
      dataEndTime: input.to ? `${input.to}T23:59:59Z` : input.reportEndAt ?? new Date(Date.parse(input.endExclusive) - 1000).toISOString(),
      reportOptions: { dateGranularity: "DAY", asinGranularity: "CHILD" },
    });
  }
  /** Reports v2021-06-30 createReport, registered non-restricted type only.
   * https://developer-docs.amazon.com/sp-api/reference/createreport */
  async createReport(input: { reportType: string; marketplaceId: string; from: string; to: string }): Promise<unknown> {
    return this.request("POST", "/reports/2021-06-30/reports", { reportType: input.reportType, marketplaceIds: [input.marketplaceId], dataStartTime: input.from, dataEndTime: input.to });
  }
  /** Reports v2021-06-30 createReport for the two request-only FBA reports.
   * Their reviewed catalog entries do not define a date window; do not send one.
   * https://developer-docs.amazon.com/sp-api/reference/createreport
   */
  async createAllListingsReport(marketplaceId: string): Promise<unknown> {
    return this.request("POST", "/reports/2021-06-30/reports", { reportType: "GET_MERCHANT_LISTINGS_ALL_DATA", marketplaceIds: [marketplaceId], reportOptions: { preferredReportDocumentLocale: "en_US" } });
  }
  async createSnapshotReport(input: { reportType: string; marketplaceId: string }): Promise<unknown> {
    return this.request("POST", "/reports/2021-06-30/reports", { reportType: input.reportType, marketplaceIds: [input.marketplaceId] });
  }
  /** Reports v2021-06-30 FBA Inventory Ledger Detailed View. The event filter
   * and closed date window are frozen by the approval workflow.
   */
  async createInventoryLedgerReport(input: { marketplaceId: string; from: string; to: string; eventType: string }): Promise<unknown> {
    const allowed = ["", "Adjustments", "CustomerReturns", "Receipts", "Shipments", "VendorReturns", "WhseTransfers"];
    if (!allowed.includes(input.eventType) || !/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}T23:59:59Z$/.test(input.to)) throw new AmazonSpApiError("库存事件报告范围无效。");
    return this.request("POST", "/reports/2021-06-30/reports", {
      reportType: "GET_LEDGER_DETAIL_VIEW_DATA", marketplaceIds: [input.marketplaceId],
      dataStartTime: input.from, dataEndTime: input.to, reportOptions: { eventType: input.eventType },
    });
  }
  /** Reports v2021-06-30 getReports. Amazon requires a nextToken follow-up to
   * contain only nextToken, so keep the token branch separate from initial filters.
   * https://developer-docs.amazon.com/sp-api/reference/getreports
   */
  async getReports(input: { reportType: string; marketplaceId: string; createdSince: string; createdUntil: string; nextToken?: string }): Promise<unknown> {
    const query = new URLSearchParams();
    if (input.nextToken) query.set("nextToken", input.nextToken);
    else {
      query.set("reportTypes", input.reportType);
      query.set("marketplaceIds", input.marketplaceId);
      query.set("createdSince", input.createdSince);
      query.set("createdUntil", input.createdUntil);
      query.set("pageSize", "100");
    }
    return this.request("GET", `/reports/2021-06-30/reports?${query.toString()}`);
  }
  /** Reports v2021-06-30 https://developer-docs.amazon.com/sp-api/reference/getreport */
  async getReport(reportId: string): Promise<unknown> {
    return this.request("GET", `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`);
  }
  /** Reports v2021-06-30 https://developer-docs.amazon.com/sp-api/reference/getreportdocument */
  async getReportDocument(documentId: string): Promise<unknown> {
    return this.request("GET", `/reports/2021-06-30/documents/${encodeURIComponent(documentId)}`);
  }
  /** Presigned S3 downloads never receive LWA/AWS headers and never follow redirects. */
  async downloadReportDocument(value: unknown): Promise<unknown> { return this.downloadReport(value, false); }
  /** Reports v2021-06-30 TSV path; identical URL/auth/size safeguards to JSON.
   * https://developer-docs.amazon.com/sp-api/docs/retrieve-a-report */
  async downloadReportText(value: unknown): Promise<string> { return this.downloadReport(value, true) as Promise<string>; }
  private async downloadReport(value: unknown, textOnly: boolean): Promise<unknown> {
    const document = value as { url?: unknown; compressionAlgorithm?: unknown } | null;
    if (!document || typeof document.url !== "string") throw new AmazonSpApiError("报告下载地址缺失。");
    const url = new URL(document.url);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || (url.hostname !== this.reportDownloadTestHost && !/^(?:[a-z0-9.-]+\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com(?:\.cn)?$/.test(url.hostname))) throw new AmazonSpApiError("报告下载地址不在允许的 S3 HTTPS 范围。");
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
      if (textOnly) {
        try { return new TextDecoder("utf-8", { fatal: true }).decode(decoded); }
        catch { throw new AmazonSpApiError("退货报告不是有效 UTF-8。"); }
      }
      try { return JSON.parse(decoded.toString("utf8")); } catch { throw new AmazonSpApiError("报告不是有效 JSON。"); }
    } catch (error) {
      if (error instanceof AmazonSpApiError) throw error;
      // Signed URLs and upstream exception text must never reach logs or responses.
      throw new AmazonSpApiError("报告下载或解压失败。", { retryable: true });
    }
  }

  async request(method: "GET" | "POST", path: string, body?: unknown, captureRaw?: (text: string) => void, rawOnly = false): Promise<unknown> {
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
      "user-agent": userAgent,
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
    const text = captureRaw ? await readBoundedOrderResponse(response) : await response.text();
    const payload = rawOnly ? undefined : parseResponseBody(text);
    if (!response.ok) {
      throw new AmazonSpApiError(safeAmazonErrorMessage(response.status, payload, this.secretValues(accessToken)), {
        status: response.status,
        authorizationRejected: response.status === 401,
        retryable: response.status === 429 || response.status >= 500,
        retryAfterMs: readRetryAfter(response.headers.get("retry-after"), this.now()),
      });
    }
    captureRaw?.(text);
    return payload;
  }

  private async getAccessToken(): Promise<string> {
    const nowMs = this.now().getTime();
    if (this.tokenState.token && this.tokenState.token.expiresAt > nowMs) return this.tokenState.token.value;
    if (this.tokenState.refreshInFlight) return this.tokenState.refreshInFlight;
    const refresh = this.refreshAccessToken();
    this.tokenState.refreshInFlight = refresh;
    try { return await refresh; } finally { if (this.tokenState.refreshInFlight === refresh) this.tokenState.refreshInFlight = null; }
  }

  private async refreshAccessToken(): Promise<string> {

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.config.refreshToken,
      client_id: this.config.lwaClientId,
      client_secret: this.config.lwaClientSecret,
    });
    const response = await this.fetchWithTimeout(this.tokenEndpoint, {
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
    this.tokenState.token = {
      value: payload.access_token,
      expiresAt: this.now().getTime() + Math.max(0, payload.expires_in * 1000 - tokenRefreshSkewMs),
    };
    return this.tokenState.token.value;
  }

  private async fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetcher(input, { ...init, signal: controller.signal });
      this.onResponse?.({ operation: input === this.tokenEndpoint ? "LWA" : inboundRequestOperation(input) ?? (input.includes("/products/pricing/v0/price") ? "getPricing" : input.includes("/products/pricing/2022-05-01/") ? "getCompetitiveSummary" : new URL(input).pathname === "/finances/2024-06-19/transactions" ? "listTransactions" : new URL(input).pathname.startsWith("/orders/2026-01-01/orders/") ? "getOrder" : input.includes("/orders/2026-01-01/orders") ? "searchOrders" : input.includes("/fba/inventory/") ? "getInventorySummaries" : input.includes("/catalog/2022-04-01/items/") ? "getCatalogItem" : input.includes("/listings/") ? (new URL(input).pathname.split("/").length > 5 ? "getListingsItem" : "searchListingsItems") : input.includes("/reports/2021-06-30/documents/") ? "getReportDocument" : new URL(input).pathname === "/reports/2021-06-30/reports" && new URL(input).searchParams.has("nextToken") ? "getReports" : new URL(input).pathname === "/reports/2021-06-30/reports" && new URL(input).searchParams.has("reportTypes") ? "getReports" : input.includes("/reports/2021-06-30/reports/") ? "getReport" : input.includes("/reports/2021-06-30/reports") ? "createReport" : "getMarketplaceParticipations"), status: response.status,
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
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  const firstError = record && Array.isArray(record.errors) && record.errors[0] && typeof record.errors[0] === "object" ? record.errors[0] as Record<string, unknown> : null;
  const rawMessage = firstError?.message ?? firstError?.code ?? record?.message ?? record?.error_description ?? record?.error;
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

async function readBoundedOrderResponse(response: Response): Promise<string> {
  const limit = 4 * 1024 * 1024;
  if (!response.body || Number(response.headers.get("content-length") ?? 0) > limit) {
    await response.body?.cancel(); throw new AmazonSpApiError("订单响应缺失或超过单页大小限制。");
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new AmazonSpApiError("订单响应超过单页大小限制。"); }
      chunks.push(part.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (error) {
    if (error instanceof AmazonSpApiError) throw error;
    throw new AmazonSpApiError("订单响应读取失败。", { retryable: true });
  } finally { reader.releaseLock(); }
}
