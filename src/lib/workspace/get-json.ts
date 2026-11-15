"use client";

import { extHeaders } from "./ext-headers";

export type GetJsonResult<T> = { ok: boolean; status: number; data: T };

/**
 * 统一 GET 取数入口：同一时刻、同一工作区、同一 URL 的 GET 只发一次网络请求。
 *
 * 只合并「仍在进行中」的请求，不缓存结果：请求结束后再调用会重新发请求，
 * 因此数据新鲜度不受影响；写请求（POST/PATCH/PUT/DELETE）不要走这里。
 *
 * 存在的意义不只是省流量：服务端每个请求都要重解会话、查授权，
 * 开发模式下 StrictMode 把 effect 跑两遍、两个组件读同一份数据，
 * 都会把这些成本翻倍，并且容易在慢查询上叠加成秒级。
 */
const inflight = new Map<string, Promise<GetJsonResult<unknown>>>();
const stats = { requests: 0, shared: 0 };

function workspaceOf(headers: Headers) {
  return headers.get("x-workspace-id") ?? "default";
}

/** 诊断用：累计网络请求数、被合并的调用数、当前在途请求数。 */
export function readGetDedupStats() {
  return { ...stats, inflight: inflight.size };
}

export function resetGetDedupStats() {
  stats.requests = 0;
  stats.shared = 0;
}

export function getJson<T = unknown>(url: string, init?: { headers?: HeadersInit }): Promise<GetJsonResult<T>> {
  const headers = new Headers(init?.headers ?? extHeaders());
  const key = `${workspaceOf(headers)} ${url}`;

  const existing = inflight.get(key);
  if (existing) {
    stats.shared++;
    return existing as Promise<GetJsonResult<T>>;
  }

  const task = (async (): Promise<GetJsonResult<T>> => {
    stats.requests++;
    const response = await fetch(url, { headers, cache: "no-store" });
    const data = (await response.json()) as T;
    return { ok: response.ok, status: response.status, data };
  })();

  inflight.set(key, task as Promise<GetJsonResult<unknown>>);
  const clear = () => {
    if (inflight.get(key) === task) inflight.delete(key);
  };
  task.then(clear, clear);
  return task;
}
