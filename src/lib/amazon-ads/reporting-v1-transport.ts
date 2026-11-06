import { AdsQueryError } from "./query-contract";
import { parseReportingV1Envelope, type ReportingV1ReportEnvelope, type ReportingV1RequestError } from "./reporting-contract";
import type { AdsRegion } from "./oauth-contract";
import { adsRegionHosts } from "./oauth-contract";
import { ReportReadRetryError, reportReadRetryAt } from "./report-retry";

export type ReportingV1CreateReport = {
  format: "CSV" | "GZIP_JSON" | "PARTITIONED_CSV" | "PARTITIONED_GZIP_JSON";
  periods: [{ datePeriod: { startDate: string; endDate: string } }];
  query: { fields: string[]; filter?: ReportingV1Filter };
};

export type ReportingV1Filter = { and: { filters: ReportingV1Filter[] } } | { on: { comparisonOperator: "EQUALS" | "IN"; field: string; not: boolean; values: string[] } };

export type ReportingV1Part = ReportingV1ReportEnvelope["parts"][number] & { url: string };
type ReportingV1Receipt = Omit<ReportingV1ReportEnvelope, "parts"> & { parts: ReportingV1Part[]; periods: [{ datePeriod: { startDate: string; endDate: string } }]; query: { fields: string[]; filter?: unknown } };
export type ReportingV1Result = ReportingV1RequestError | ReportingV1Receipt;

export interface ReportingV1Transport {
  create(input: { region: AdsRegion; clientId: string; accessToken: string; advertiserAccountId: string; report: ReportingV1CreateReport; signal?: AbortSignal }): Promise<ReportingV1Result>;
  retrieve(input: { region: AdsRegion; clientId: string; accessToken: string; reportId: string; signal?: AbortSignal }): Promise<ReportingV1Result>;
  download(input: { url: string; expiresAt: string; maxBytes: number; expectedBytes: number; signal?: AbortSignal }): Promise<Buffer>;
}

const formats = new Set(["CSV", "GZIP_JSON", "PARTITIONED_CSV", "PARTITIONED_GZIP_JSON"]);
const dateOnly = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const safeId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);

// Local resource limits supplement (and do not redefine) the Amazon OAS limits.
function snapshotFilter(value: unknown, depth = 0, budget = { nodes: 0, values: 0, characters: 0 }): ReportingV1Filter {
  if (++budget.nodes > 100 || depth > 8 || !value || typeof value !== "object" || Array.isArray(value)) throw new AdsQueryError("ADS_REPORT_V1_FILTER_INVALID");
  const node = value as Record<string, unknown>;
  if (Object.keys(node).length !== 1) throw new AdsQueryError("ADS_REPORT_V1_FILTER_INVALID");
  if (Object.hasOwn(node, "and")) {
    const and = node.and;
    if (!and || typeof and !== "object" || Array.isArray(and) || Object.keys(and).length !== 1 || !Array.isArray((and as Record<string, unknown>).filters)) throw new AdsQueryError("ADS_REPORT_V1_FILTER_INVALID");
    const filters = (and as { filters: unknown[] }).filters;
    if (filters.length < 1 || filters.length > 10) throw new AdsQueryError("ADS_REPORT_V1_FILTER_INVALID");
    return { and: { filters: Array.from(filters, filter => snapshotFilter(filter, depth + 1, budget)) } };
  }
  if (Object.hasOwn(node, "on")) {
    const on = node.on;
    if (!on || typeof on !== "object" || Array.isArray(on)) throw new AdsQueryError("ADS_REPORT_V1_FILTER_INVALID");
    const predicate = on as Record<string, unknown>;
    if (Object.keys(predicate).length !== 4 || typeof predicate.comparisonOperator !== "string" || !["EQUALS", "IN"].includes(predicate.comparisonOperator) || typeof predicate.field !== "string" || predicate.field.length > 512 || !/^[a-zA-Z0-9]+\.[a-zA-Z0-9]+$/.test(predicate.field)
      || typeof predicate.not !== "boolean" || !Array.isArray(predicate.values) || predicate.values.length < 1 || predicate.values.length > 2000
      || Array.from(predicate.values).some(item => typeof item !== "string" || item.length > 512 || /[\u0000-\u001f\u007f]/.test(item) || ++budget.values > 2000 || (budget.characters += item.length) > 256 * 1024)
      || (predicate.comparisonOperator === "EQUALS" && predicate.values.length !== 1)) throw new AdsQueryError("ADS_REPORT_V1_FILTER_INVALID");
    return { on: { comparisonOperator: predicate.comparisonOperator as "EQUALS" | "IN", field: predicate.field, not: predicate.not, values: [...predicate.values] as string[] } };
  }
  throw new AdsQueryError("ADS_REPORT_V1_FILTER_INVALID");
}

function validateCreate(value: ReportingV1CreateReport) {
  if (!value || typeof value !== "object" || !formats.has(value.format) || !Array.isArray(value.periods) || value.periods.length !== 1
    || !value.periods[0]?.datePeriod || !dateOnly(value.periods[0].datePeriod.startDate) || !dateOnly(value.periods[0].datePeriod.endDate)
    || Object.keys(value.periods[0]).some(key => key !== "datePeriod") || Object.keys(value.periods[0].datePeriod).some(key => !["startDate", "endDate"].includes(key))
    || value.periods[0].datePeriod.startDate > value.periods[0].datePeriod.endDate || !value.query || !Array.isArray(value.query.fields)
    || Object.keys(value).some(key => !["format", "periods", "query"].includes(key))
    || Object.keys(value.query).some(key => !["fields", "filter"].includes(key))
    || value.query.fields.length < 1 || value.query.fields.length > 1000 || Array.from(value.query.fields).some(field => !safeId(field))) {
    throw new AdsQueryError("ADS_REPORT_V1_REQUEST_INVALID");
  }
}

/** Canonical defensive snapshot, also used by the persisted V1 protocol fixture. */
export function snapshotReportingV1CreateReport(value: ReportingV1CreateReport): ReportingV1CreateReport {
  validateCreate(value);
  const fields = [...value.query.fields];
  if (fields.reduce((sum, field) => sum + field.length, 0) > 64 * 1024) throw new AdsQueryError("ADS_REPORT_V1_REQUEST_INVALID");
  const report: ReportingV1CreateReport = {
    format: value.format,
    periods: [{ datePeriod: { startDate: value.periods[0].datePeriod.startDate, endDate: value.periods[0].datePeriod.endDate } }],
    query: { fields, ...(value.query.filter === undefined ? {} : { filter: snapshotFilter(value.query.filter) }) },
  };
  if (Buffer.byteLength(JSON.stringify(report)) > 512 * 1024) throw new AdsQueryError("ADS_REPORT_V1_REQUEST_INVALID");
  return report;
}

/** Both create and subsequent polls must match the frozen report contract. */
export function assertReportingV1ReceiptMatches(result: ReportingV1Result, expected: ReportingV1CreateReport) {
  if (result.outcome !== "success") return;
  let actual: ReportingV1CreateReport;
  try { actual = snapshotReportingV1CreateReport({ format: result.format, periods: result.periods, query: result.query as ReportingV1CreateReport["query"] }); }
  catch { throw new AdsQueryError("ADS_REPORT_V1_RECEIPT_MISMATCH"); }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new AdsQueryError("ADS_REPORT_V1_RECEIPT_MISMATCH");
}

function validateCredentials(input: { region: AdsRegion; clientId: string; accessToken: string }) {
  if (!Object.hasOwn(adsRegionHosts, input.region) || typeof input.clientId !== "string" || !input.clientId.trim() || input.clientId.length > 512 || typeof input.accessToken !== "string" || !input.accessToken.trim() || input.accessToken.length > 16384 || /[\r\n]/.test(input.clientId + input.accessToken)) throw new AdsQueryError("ADS_REPORT_V1_AUTH_INVALID");
}

function operationSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(20000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function fetchWithAbort(fetcher: typeof fetch, url: string | URL, init: RequestInit & { signal: AbortSignal }): Promise<Response> {
  if (init.signal.aborted) throw new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT");
  let abort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT"));
    init.signal.addEventListener("abort", abort, { once: true });
  });
  // Even an injected/broken fetcher that ignores AbortSignal cannot hold a worker indefinitely.
  const pending = Promise.resolve().then(() => fetcher(url, init)).then(response => {
    if (init.signal.aborted) { void response.body?.cancel().catch(() => undefined); throw new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT"); }
    return response;
  });
  try { return await Promise.race([pending, aborted]); }
  finally { init.signal.removeEventListener("abort", abort); }
}

async function readResponse(response: Response, signal: AbortSignal, maximumBytes: number, accepted: readonly number[], readOnly: boolean) {
  if (signal.aborted) { void response.body?.cancel().catch(() => undefined); throw new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT"); }
  if (response.redirected || !accepted.includes(response.status)) {
    const status = response.status;
    void response.body?.cancel().catch(() => undefined);
    if (status === 429 || status >= 500) {
      if (!readOnly) throw new AdsQueryError("ADS_REPORT_CREATE_RESULT_UNKNOWN");
      throw new ReportReadRetryError(status === 429 ? "ADS_REPORT_THROTTLED" : "ADS_REPORT_UPSTREAM_UNAVAILABLE", reportReadRetryAt(1, response.headers.get("retry-after")));
    }
    throw new AdsQueryError("ADS_REPORT_V1_HTTP_REJECTED");
  }
  const announced = response.headers.get("content-length");
  if (announced !== null && (!/^\d+$/.test(announced) || Number(announced) > maximumBytes)) { void response.body?.cancel().catch(() => undefined); throw new AdsQueryError("ADS_REPORT_BODY_LIMIT"); }
  const reader = response.body?.getReader();
  if (!reader) throw new AdsQueryError("ADS_REPORT_BODY_MISSING");
  const chunks: Buffer[] = [];
  let size = 0;
  let abort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => { reject(new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT")); void reader.cancel().catch(() => undefined); };
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    for (;;) {
      if (signal.aborted) throw new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT");
      const chunk = await Promise.race([reader.read(), aborted]);
      if (signal.aborted) throw new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT");
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumBytes) throw new AdsQueryError("ADS_REPORT_BODY_LIMIT");
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (announced !== null && size !== Number(announced)) throw new AdsQueryError("ADS_REPORT_BODY_SIZE_MISMATCH");
  return Buffer.concat(chunks);
}

function parseResult(bytes: Buffer): ReportingV1Result {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new AdsQueryError("ADS_REPORT_ENVELOPE_INVALID"); }
  const parsed = parseReportingV1Envelope(value);
  if (parsed.outcome === "error") return parsed;
  const body = value as { success: Array<{ report: { periods: [{ datePeriod: { startDate: string; endDate: string } }]; query: { fields: string[]; filter?: unknown }; completedReportParts?: Array<{ url: string; sizeInBytes: number; urlExpirationDateTime: string }> } }> };
  const receipt = body.success[0].report;
  const rawParts = receipt.completedReportParts ?? [];
  return { ...parsed, periods: receipt.periods, query: receipt.query, parts: rawParts.map(part => ({ sizeInBytes: part.sizeInBytes, urlExpirationDateTime: part.urlExpirationDateTime, url: part.url })) };
}

/** Injectable protocol adapter only. No production factory/dispatch is enabled. URLs stay server-side. */
export function createReportingV1Transport(fetcher: typeof fetch, configuredDownloadHosts: readonly string[] = []): ReportingV1Transport {
  const downloadHosts = new Set(configuredDownloadHosts.map(host => host.toLowerCase()));
  if (configuredDownloadHosts.some(host => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host))) throw new AdsQueryError("ADS_REPORT_DOWNLOAD_ALLOWLIST_INVALID");
  async function post(input: { region: AdsRegion; clientId: string; accessToken: string; body: unknown; signal?: AbortSignal }, path: string) {
    validateCredentials(input);
    const signal = operationSignal(input.signal);
    let response: Response;
    try {
      response = await fetchWithAbort(fetcher, `${adsRegionHosts[input.region]}${path}`, {
        method: "POST", headers: { "Amazon-Ads-ClientId": input.clientId, Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(input.body), cache: "no-store", redirect: "error", signal,
      });
    } catch {
      if (path.endsWith("/create/reports")) throw new AdsQueryError("ADS_REPORT_CREATE_RESULT_UNKNOWN");
      if (input.signal?.aborted) throw new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT");
      throw new ReportReadRetryError("ADS_REPORT_UPSTREAM_UNAVAILABLE", reportReadRetryAt(1));
    }
    const readOnly = path.endsWith("/retrieve/reports");
    try {
      const bytes = await readResponse(response, signal, 64 * 1024, [207], readOnly);
      return parseResult(bytes);
    } catch (error) {
      // A malformed, lost or interrupted create receipt cannot prove no report was created.
      if (!readOnly) throw new AdsQueryError("ADS_REPORT_CREATE_RESULT_UNKNOWN");
      throw error;
    }
  }

  return {
    async create(input) {
      validateCreate(input.report);
      if (!safeId(input.advertiserAccountId)) throw new AdsQueryError("ADS_REPORT_V1_ACCOUNT_INVALID");
      const report = snapshotReportingV1CreateReport(input.report);
      const result = await post({ ...input, body: { accessRequestedAccounts: [{ advertiserAccountId: input.advertiserAccountId }], reports: [report] } }, "/adsApi/v1/create/reports");
      assertReportingV1ReceiptMatches(result, report);
      return result;
    },
    async retrieve(input) {
      if (!safeId(input.reportId)) throw new AdsQueryError("ADS_REPORT_V1_ID_INVALID");
      const result = await post({ ...input, body: { reportIds: [input.reportId] } }, "/adsApi/v1/retrieve/reports");
      if (result.outcome === "success" && result.reportId !== input.reportId) throw new AdsQueryError("ADS_REPORT_V1_ID_MISMATCH");
      return result;
    },
    async download(input) {
      if (!Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now()) throw new AdsQueryError("ADS_REPORT_DOWNLOAD_EXPIRED");
      if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > 8 * 1024 * 1024 || !Number.isSafeInteger(input.expectedBytes) || input.expectedBytes < 0 || input.expectedBytes > input.maxBytes || typeof input.url !== "string") throw new AdsQueryError("ADS_REPORT_BODY_LIMIT");
      let url: URL;
      try { url = new URL(input.url); } catch { throw new AdsQueryError("ADS_REPORT_DOWNLOAD_URL_REJECTED"); }
      if (!input.url.startsWith("https://") || url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !downloadHosts.has(url.hostname.toLowerCase()) || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) throw new AdsQueryError("ADS_REPORT_DOWNLOAD_URL_REJECTED");
      const signal = operationSignal(input.signal);
      let response: Response;
      try { response = await fetchWithAbort(fetcher, url, { method: "GET", cache: "no-store", redirect: "error", signal }); }
      catch { if (input.signal?.aborted) throw new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT"); throw new AdsQueryError("ADS_REPORT_DOWNLOAD_FAILED"); }
      const bytes = await readResponse(response, signal, input.maxBytes, [200], true);
      if (Date.parse(input.expiresAt) <= Date.now()) throw new AdsQueryError("ADS_REPORT_DOWNLOAD_EXPIRED");
      if (bytes.length !== input.expectedBytes) throw new AdsQueryError("ADS_REPORT_BODY_SIZE_MISMATCH");
      return bytes;
    },
  };
}
