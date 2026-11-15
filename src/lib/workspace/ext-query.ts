import { extHeaders } from "./ext-headers";
import { writeWorkspaceApiQuery, workspaceApiCacheToken } from "./workspace-api-cache";

/**
 * `/api/operations/ext` 的统一取数入口。
 *
 * 同一个查询键在同一时刻只会有一个网络请求：两个组件读同一份数据、或者开发模式下
 * StrictMode 把 effect 跑两遍，都只会真正发一次。这不只是省流量——每个请求在服务端
 * 都要重新解会话、查授权，并发的重复请求会把这些成本翻倍。
 *
 * 结果同时写进查询缓存，页面挂载时先用缓存出内容。
 */
const inflight = new Map<string, Promise<unknown>>();

export function fetchExtQuery<T = unknown>(key: string): Promise<T> {
  const token = workspaceApiCacheToken();
  const requestKey = `${token}:${key}`;
  const existing = inflight.get(requestKey);
  if (existing) return existing as Promise<T>;

  const task = (async () => {
    const response = await fetch(`/api/operations/ext?${key}`, { headers: extHeaders(), cache: "no-store" });
    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(payload?.error ?? "读取失败。");
    if (token !== workspaceApiCacheToken()) throw new Error("工作区身份已变化，丢弃过期查询响应。");
    writeWorkspaceApiQuery(key, payload);
    return payload;
  })();

  inflight.set(requestKey, task);
  const clear = () => {
    if (inflight.get(requestKey) === task) inflight.delete(requestKey);
  };
  task.then(clear, clear);
  return task;
}
