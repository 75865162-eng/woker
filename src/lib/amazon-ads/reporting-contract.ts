export type ReportingV1Status = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface ReportingV1ReportEnvelope {
  outcome: "success";
  reportId: string;
  status: ReportingV1Status;
  format: "CSV" | "GZIP_JSON" | "PARTITIONED_CSV" | "PARTITIONED_GZIP_JSON";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failureCode?: string;
  warnings: Array<{ field: string; codes: string[] }>;
  parts: Array<{ sizeInBytes: number; urlExpirationDateTime: string }>;
}

export interface ReportingV1RequestError {
  outcome: "error";
  errors: Array<{ code: string; fieldLocation?: string }>;
}

const reportStatuses = new Set<ReportingV1Status>(["PENDING", "PROCESSING", "COMPLETED", "FAILED"]);
const reportFormats = new Set<ReportingV1ReportEnvelope["format"]>(["CSV", "GZIP_JSON", "PARTITIONED_CSV", "PARTITIONED_GZIP_JSON"]);
const warningCodes = new Set(["DATE_LIMITED", "NO_PERMISSION", "PENDING_DEPRECATION"]);

/** Parses only the Reporting v1 task envelope; it never downloads or exposes temporary part URLs. */
export function parseReportingV1Envelope(value: unknown): ReportingV1ReportEnvelope | ReportingV1RequestError {
  const body = record(value);
  if (!body || !optionalArray(body.success) || !optionalArray(body.error) || (body.success?.length ?? 0) + (body.error?.length ?? 0) !== 1) {
    throw new Error("ADS_REPORT_ENVELOPE_INVALID");
  }

  if (body.error?.length) {
    const indexed = record(body.error[0]);
    const issues = indexed && Number.isInteger(indexed.index) && Array.isArray(indexed.errors) && indexed.errors.length >= 1 && indexed.errors.length <= 20 ? indexed.errors.map(record) : null;
    if (indexed?.index !== 0 || !issues || issues.some(issue => !issue || typeof issue.code !== "string" || !issue.code || (issue.fieldLocation !== undefined && typeof issue.fieldLocation !== "string"))) {
      throw new Error("ADS_REPORT_ENVELOPE_INVALID");
    }
    return { outcome: "error", errors: issues.map(issue => ({ code: issue!.code as string, ...(typeof issue!.fieldLocation === "string" ? { fieldLocation: issue!.fieldLocation } : {}) })) };
  }

  const indexed = record(body.success?.[0]);
  const report = indexed && indexed.index === 0 ? record(indexed.report) : null;
  if (!report || typeof report.reportId !== "string" || !report.reportId || typeof report.status !== "string" || !reportStatuses.has(report.status as ReportingV1Status)
    || typeof report.format !== "string" || !reportFormats.has(report.format as ReportingV1ReportEnvelope["format"])
    || !validDateTime(report.creationDateTime) || !validDateTime(report.lastUpdatedDateTime)
    || (report.completedDateTime !== undefined && !validDateTime(report.completedDateTime))
    || (report.failureCode !== undefined && typeof report.failureCode !== "string")
    || !Array.isArray(report.periods) || report.periods.length !== 1 || !validPeriod(report.periods[0]) || !record(report.query) || !Array.isArray((report.query as Record<string, unknown>).fields)
    || ((report.query as Record<string, unknown>).fields as unknown[]).length < 1 || ((report.query as Record<string, unknown>).fields as unknown[]).length > 1000
    || ((report.query as Record<string, unknown>).fields as unknown[]).some(field => typeof field !== "string")) {
    throw new Error("ADS_REPORT_ENVELOPE_INVALID");
  }

  const rawParts = report.completedReportParts ?? [];
  if (!Array.isArray(rawParts) || rawParts.length > 100) throw new Error("ADS_REPORT_ENVELOPE_INVALID");
  const parts = rawParts.map(partValue => {
    const part = record(partValue);
    if (!part || typeof part.sizeInBytes !== "number" || !Number.isSafeInteger(part.sizeInBytes) || part.sizeInBytes < 0 || typeof part.url !== "string" || !isHttpsUrl(part.url) || !validDateTime(part.urlExpirationDateTime)) {
      throw new Error("ADS_REPORT_ENVELOPE_INVALID");
    }
    return { sizeInBytes: part.sizeInBytes, urlExpirationDateTime: part.urlExpirationDateTime };
  });

  const rawWarnings = report.warnings ?? [];
  if (!Array.isArray(rawWarnings) || rawWarnings.length > 1000) throw new Error("ADS_REPORT_ENVELOPE_INVALID");
  const warnings = rawWarnings.map(warningValue => {
    const warning = record(warningValue);
    if (!warning || typeof warning.field !== "string" || !/^[a-zA-Z0-9]+\.[a-zA-Z0-9]+$/.test(warning.field)
      || !Array.isArray(warning.warningCodes) || warning.warningCodes.length < 1 || warning.warningCodes.length > 100
      || warning.warningCodes.some(code => typeof code !== "string" || !warningCodes.has(code))) throw new Error("ADS_REPORT_ENVELOPE_INVALID");
    return { field: warning.field, codes: warning.warningCodes as string[] };
  });

  return {
    outcome: "success", reportId: report.reportId, status: report.status as ReportingV1Status,
    format: report.format as ReportingV1ReportEnvelope["format"], createdAt: report.creationDateTime,
    updatedAt: report.lastUpdatedDateTime, ...(typeof report.completedDateTime === "string" ? { completedAt: report.completedDateTime } : {}),
    ...(typeof report.failureCode === "string" ? { failureCode: report.failureCode } : {}), warnings, parts,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function optionalArray(value: unknown): value is unknown[] | undefined { return value === undefined || Array.isArray(value); }
function validDateTime(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}
function validPeriod(value: unknown) {
  const period = record(value), dates = period && record(period.datePeriod);
  return Boolean(dates && validDate(dates.startDate) && validDate(dates.endDate) && dates.startDate <= dates.endDate);
}
function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function isHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return value.startsWith("https://") && url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  }
  catch { return false; }
}
