/**
 * 统一 API 响应包裹（F6）。
 *
 * 目的：给全站 route handler 一个一致的响应范式（统一分页结构、统一错误结构），
 * 供前端统一取数层稳定解析。纯增量工具：不改动任何既有路由的行为，
 * 新路由/新接口优先采用，旧路由按批次迁移。
 *
 * 约定：
 * - 分页响应统一为 `{ rows, pagination: { page, pageSize, total } }`（与赛狐 [domain] 现有口径一致）；
 * - 错误统一为 `{ error: string }`，HTTP status 语义化；
 * - 所有响应默认 `Cache-Control: no-store`（私有 ERP 数据不进 HTTP/CDN 缓存）。
 */
import { NextResponse } from "next/server";

export type Pagination = { page: number; pageSize: number; total: number };

const NO_STORE = { "Cache-Control": "no-store" };

/** 成功响应（业务数据体原样展开）。 */
export function apiOk<T extends Record<string, unknown>>(body: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, { ...init, headers: { ...NO_STORE, ...(init?.headers ?? {}) } });
}

/** 错误响应：统一 `{ error }` 结构。 */
export function apiError(message: string, status = 500, init?: ResponseInit): NextResponse {
  return NextResponse.json({ error: message }, { ...init, status, headers: { ...NO_STORE, ...(init?.headers ?? {}) } });
}

/** 分页响应：统一 `{ rows, pagination }` 结构。 */
export function apiPaged<T>(
  rows: T[],
  pagination: Pagination,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ rows, pagination, ...(extra ?? {}) }, { headers: NO_STORE });
}

/** 从 URLSearchParams 安全解析分页，带上下界钳制。 */
export function parsePagination(
  params: URLSearchParams,
  defaults: { pageSize?: number; maxPageSize?: number } = {},
): { page: number; pageSize: number } {
  const defaultSize = defaults.pageSize ?? 20;
  const maxSize = defaults.maxPageSize ?? 200;
  const toInt = (v: string | null, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  return {
    page: toInt(params.get("page"), 1),
    pageSize: Math.min(maxSize, toInt(params.get("pageSize"), defaultSize)),
  };
}
