import { assertAmazonCloudExecution } from "@/lib/amazon/execution-role";
import { adsRegionHosts, type AdsRegion } from "./oauth-contract";
import { AdsQueryError } from "./query-contract";
import { ReportReadRetryError, reportReadRetryAt } from "./report-retry";
import type { SpReportRequest } from "./sp-report-types";

/** Reporting v3 回执。COMPLETED 时才带 url；FAILED 时带 failureReason。 */
export type SpReportReceipt = {
  reportId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  url?: string;
  failureReason?: string;
};

export interface SpReportTransport {
  create(input: { region: AdsRegion; clientId: string; accessToken: string; profileId: string; advertiserAccountId: string | null; request: SpReportRequest }): Promise<SpReportReceipt>;
  retrieve(input: { region: AdsRegion; clientId: string; accessToken: string; profileId: string; reportId: string }): Promise<SpReportReceipt>;
  download(input: { url: string; maxBytes: number }): Promise<Buffer>;
}

const statuses = new Set(["PENDING", "PROCESSING", "COMPLETED", "FAILED"]);
const acceptedHost = (host: string, extra: readonly string[]) => {
  const value = host.toLowerCase();
  return extra.includes(value) || value === "amazonaws.com" || value.endsWith(".amazonaws.com") || value === "amazon.com" || value.endsWith(".amazon.com");
};

function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function operationSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(30000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function parseReceipt(value: unknown): SpReportReceipt {
  const root = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  // 官方 200 直接返回 reportId/status；兼容 reports[] 包装，避免上游版本差异导致误判。
  const candidate = (root.report && typeof root.report === "object" && !Array.isArray(root.report) ? root.report as Record<string, unknown> : undefined)
    ?? (Array.isArray(root.reports) && root.reports[0] && typeof root.reports[0] === "object" ? root.reports[0] as Record<string, unknown> : undefined)
    ?? root;
  const reportId = candidate.reportId;
  const status = typeof candidate.status === "string" ? candidate.status.toUpperCase() : "";
  if (!safeId(reportId) || !statuses.has(status)) throw new AdsQueryError("ADS_REPORT_ENVELOPE_INVALID");
  const url = typeof candidate.url === "string" && candidate.url ? candidate.url : undefined;
  const failureReason = typeof candidate.failureReason === "string" ? candidate.failureReason.slice(0, 300) : undefined;
  if (status === "COMPLETED" && !url) throw new AdsQueryError("ADS_REPORT_ENVELOPE_INVALID");
  return { reportId, status: status as SpReportReceipt["status"], ...(url ? { url } : {}), ...(failureReason ? { failureReason } : {}) };
}

async function readBounded(response: Response, maximumBytes: number): Promise<Buffer> {
  const announced = response.headers.get("content-length");
  if (announced !== null && (!/^\d+$/.test(announced) || Number(announced) > maximumBytes)) {
    void response.body?.cancel().catch(() => undefined);
    throw new AdsQueryError("ADS_REPORT_BODY_LIMIT");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new AdsQueryError("ADS_REPORT_BODY_MISSING");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumBytes) throw new AdsQueryError("ADS_REPORT_BODY_LIMIT");
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (announced !== null && size !== Number(announced)) throw new AdsQueryError("ADS_REPORT_BODY_SIZE_MISMATCH");
  return Buffer.concat(chunks);
}

async function upstreamText(response: Response) {
  try { return (await response.text()).slice(0, 500); } catch { return ""; }
}

/** 真实 HTTP 传输。只在云端执行角色下可用；本地/测试注入 fake transport。 */
export function createSpReportTransport(
  fetcher: typeof fetch = fetch,
  options: { downloadHosts?: readonly string[] } = {},
): SpReportTransport {
  const extraHosts = (options.downloadHosts ?? (process.env.AMAZON_ADS_REPORT_DOWNLOAD_HOSTS ?? "").split(",").map(host => host.trim().toLowerCase()).filter(Boolean));
  async function send(input: { region: AdsRegion; clientId: string; accessToken: string; profileId: string; body: unknown; path: string; method: "POST" | "GET"; signal?: AbortSignal }) {
    if (!Object.hasOwn(adsRegionHosts, input.region)) throw new AdsQueryError("ADS_REGION_INVALID");
    if (!safeId(input.clientId) || !safeId(input.accessToken) || !safeId(input.profileId)) throw new AdsQueryError("ADS_REPORT_AUTH_INVALID");
    assertAmazonCloudExecution();
    const signal = operationSignal(input.signal);
    let response: Response;
    try {
      response = await fetcher(`${adsRegionHosts[input.region]}${input.path}`, {
        method: input.method,
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Amazon-Ads-ClientId": input.clientId,
          "Amazon-Advertising-API-Scope": input.profileId,
          Accept: "application/json",
          ...(input.method === "POST" ? { "Content-Type": "application/vnd.createasyncreportrequest.v3+json" } : {}),
        },
        ...(input.method === "POST" ? { body: JSON.stringify(input.body) } : {}),
        cache: "no-store",
        redirect: "error",
        signal,
      });
    } catch {
      if (input.signal?.aborted) throw new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT");
      throw new ReportReadRetryError("ADS_REPORT_UPSTREAM_UNAVAILABLE", reportReadRetryAt(1));
    }
    if (response.status === 200) {
      const bytes = await readBounded(response, 256 * 1024);
      try { return parseReceipt(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
      catch (error) { if (error instanceof AdsQueryError) throw error; throw new AdsQueryError("ADS_REPORT_ENVELOPE_INVALID"); }
    }
    if (response.status === 425) {
      // 相同参数的报表已在生成中；按 Retry-After 等待后重新创建是官方建议做法。
      void response.body?.cancel().catch(() => undefined);
      throw new ReportReadRetryError("ADS_REPORT_THROTTLED", reportReadRetryAt(1, response.headers.get("retry-after") ?? "900"));
    }
    if (response.status === 429 || response.status >= 500) {
      void response.body?.cancel().catch(() => undefined);
      throw new ReportReadRetryError(response.status === 429 ? "ADS_REPORT_THROTTLED" : "ADS_REPORT_UPSTREAM_UNAVAILABLE", reportReadRetryAt(1, response.headers.get("retry-after")));
    }
    const detail = await upstreamText(response);
    if (response.status === 401) throw new AdsQueryError("ADS_REAUTH_REQUIRED");
    if (response.status === 403) throw new AdsQueryError("ADS_REPORT_FORBIDDEN");
    if (response.status === 400 && /column|field|metric|unsupported|not supported|invalid/i.test(detail)) throw new AdsQueryError("ADS_REPORT_COLUMNS_REJECTED");
    throw new AdsQueryError(response.status === 400 ? "ADS_REPORT_REQUEST_REJECTED" : "ADS_REPORT_HTTP_REJECTED");
  }

  return {
    async create(input) {
      return send({ region: input.region, clientId: input.clientId, accessToken: input.accessToken, profileId: input.profileId, body: input.request, path: "/reporting/reports", method: "POST" });
    },
    async retrieve(input) {
      if (!safeId(input.reportId)) throw new AdsQueryError("ADS_REPORT_ID_INVALID");
      return send({ region: input.region, clientId: input.clientId, accessToken: input.accessToken, profileId: input.profileId, body: null, path: `/reporting/reports/${encodeURIComponent(input.reportId)}`, method: "GET" });
    },
    async download(input) {
      if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > 64 * 1024 * 1024) throw new AdsQueryError("ADS_REPORT_BODY_LIMIT");
      let url: URL;
      try { url = new URL(input.url); } catch { throw new AdsQueryError("ADS_REPORT_DOWNLOAD_URL_REJECTED"); }
      if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !acceptedHost(url.hostname, extraHosts)) throw new AdsQueryError("ADS_REPORT_DOWNLOAD_URL_REJECTED");
      assertAmazonCloudExecution();
      const signal = operationSignal();
      let response: Response;
      try { response = await fetcher(url, { method: "GET", cache: "no-store", redirect: "error", signal }); }
      catch { throw new AdsQueryError("ADS_REPORT_DOWNLOAD_FAILED"); }
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => undefined);
        throw new AdsQueryError("ADS_REPORT_DOWNLOAD_FAILED");
      }
      return readBounded(response, input.maxBytes);
    },
  };
}
