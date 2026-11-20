/**
 * 脱敏的服务端诊断：同步中心 500 兜底此前完全吞掉异常，既不返回客户端（安全，正确），
 * 也不落日志，导致生产 500 无法定位。此处仅记录错误类型、Prisma 错误码、
 * 以及 Prisma meta 里出现的字段名（白名单为字段名字符串）；绝不记录 message、
 * 堆栈、SQL、参数、凭证或租户标识，与项目其它 operations 路由的错误日志口径一致。
 */
export function logUnexpectedSyncCenterError(error: unknown) {
  const e = error as { name?: string; code?: string; meta?: unknown };
  const name = typeof e?.name === "string" && /^[A-Za-z][A-Za-z0-9]*$/.test(e.name) ? e.name : "UnknownError";
  const code = typeof e?.code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(e.code) ? e.code : undefined;
  const meta = e?.meta && typeof e.meta === "object" && !Array.isArray(e.meta) ? e.meta as Record<string, unknown> : undefined;
  const fields = meta && "target" in meta ? (Array.isArray(meta.target) ? meta.target : [meta.target]).filter((f): f is string => typeof f === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(f)).slice(0, 10) : undefined;
  const fieldName = fields?.length ? fields.join(",") : undefined;
  console.error("[operations.sync-center]", { name, ...(code ? { code } : {}), ...(fieldName ? { field: fieldName } : {}) });
}
