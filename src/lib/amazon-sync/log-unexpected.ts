/**
 * 脱敏的服务端诊断：同步中心 500 兜底此前完全吞掉异常，既不返回客户端（安全，正确），
 * 也不落日志，导致生产 500 无法定位。此处仅记录错误类型、Prisma 错误码、
 * 底层驱动的 SQLSTATE 与类型（均为标准码/枚举，不含 SQL、参数或凭证）、
 * 触发的 section，以及 Prisma meta 里出现的字段名（白名单为字段名字符串）；
 * 绝不记录 message、堆栈、SQL、参数、凭证或租户标识，与项目其它 operations 路由的错误日志口径一致。
 */
export function logUnexpectedSyncCenterError(error: unknown, section?: string) {
  const e = error as { name?: string; code?: string; meta?: unknown };
  const name = typeof e?.name === "string" && /^[A-Za-z][A-Za-z0-9]*$/.test(e.name) ? e.name : "UnknownError";
  const code = typeof e?.code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(e.code) ? e.code : undefined;
  const meta = e?.meta && typeof e.meta === "object" && !Array.isArray(e.meta) ? e.meta as Record<string, unknown> : undefined;
  const fields = meta && "target" in meta ? (Array.isArray(meta.target) ? meta.target : [meta.target]).filter((f): f is string => typeof f === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(f)).slice(0, 10) : undefined;
  const fieldName = fields?.length ? fields.join(",") : undefined;
  // Prisma 7 driver adapter error: meta.driverAdapterError.cause.{kind,originalCode}.
  // SQLSTATE 恰为 5 位大写字母/数字（如 40001 序列化冲突、42P01 表不存在、25P02 事务已失败）；
  // 绝不记录 originalMessage（可能含 SQL、参数或凭证）。
  const dae = meta && "driverAdapterError" in meta && meta.driverAdapterError && typeof meta.driverAdapterError === "object" && !Array.isArray(meta.driverAdapterError) ? meta.driverAdapterError as Record<string, unknown> : undefined;
  const cause = dae && "cause" in dae && dae.cause && typeof dae.cause === "object" && !Array.isArray(dae.cause) ? dae.cause as Record<string, unknown> : undefined;
  const driverKind = cause && typeof cause.kind === "string" && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(cause.kind) ? cause.kind : undefined;
  const sqlstate = cause && typeof cause.originalCode === "string" && /^[0-9A-Z]{5}$/.test(cause.originalCode) ? cause.originalCode : undefined;
  const safeSection = typeof section === "string" && /^[a-z0-9-]{1,40}$/.test(section) ? section : undefined;
  console.error("[operations.sync-center]", { name, ...(code ? { code } : {}), ...(sqlstate ? { sqlstate } : {}), ...(driverKind ? { driver: driverKind } : {}), ...(fieldName ? { field: fieldName } : {}), ...(safeSection ? { section: safeSection } : {}) });
}
