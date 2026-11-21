/**
 * 预聚合读切换的「对账 verdict」持久化。
 *
 * 背景：aggregate-read-gate.readAggregateOrLive 需要 reconcileOk（0-diff 判定），
 * 但此前没有任何地方持久化这个判定 —— 闸门因此成为死代码。
 * 本模块把 `sellfox:agg-reconcile --publish-verdict` 产出的 verdict 存到 Redis，
 * 供 reader 在运行时判断「该域是否已对账通过、可以安全切读预聚合表」。
 *
 * 安全语义（红线）：
 * - 读不到 verdict（Redis 不可用 / 从未对账 / 过期）一律视为「未对账」→ 走 live，绝不空页；
 * - verdict 带 org+ws+domain 隔离，跨租户/跨域不串；
 * - 只有 reconcile 脚本确认 0-diff 后才写入 ok=true；任何 diff 都不会发布 ok；
 * - verdict 有 TTL，过期自动回到 live（防止 schema 变化后长期引用陈旧 verdict）。
 */
import RedisClient from "ioredis";

export const AGG_VERDICT_PREFIX = "sellfox:agg-verdict:";
export const AGG_VERDICT_TTL_SECONDS = 7 * 24 * 3600;

export type AggregateVerdict = { ok: boolean; at: string; sourceRows: number; aggregateRows: number };

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  on(event: string, listener: () => void): void;
};

const Redis = RedisClient as unknown as new (url: string, options: Record<string, unknown>) => RedisLike;
let client: RedisLike | undefined;
function getClient(): RedisLike | undefined {
  const url = process.env.REDIS_URL;
  if (!url) return undefined;
  if (!client) {
    client = new Redis(url, { maxRetriesPerRequest: 1, commandTimeout: 300, connectTimeout: 500, retryStrategy: () => null, enableOfflineQueue: true });
    client.on("error", () => {});
  }
  return client;
}

/** Test seam: inject a Redis-like client (or null to simulate outage). */
let injected: RedisLike | null | undefined;
export function setAggregateVerdictRedisForTest(c: RedisLike | null | undefined) { injected = c; }
function resolved(): RedisLike | undefined {
  return injected !== undefined ? (injected ?? undefined) : getClient();
}

export function aggregateVerdictKey(organizationId: string, workspaceId: string, domain: string): string {
  return `${AGG_VERDICT_PREFIX}${organizationId}:${workspaceId}:${domain}`;
}

export function parseVerdict(raw: string | null): AggregateVerdict | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as AggregateVerdict;
    if (typeof value?.ok !== "boolean" || typeof value?.at !== "string") return null;
    return value;
  } catch { return null; }
}

/** 写入 verdict。仅当 ok=true 时设置 TTL；失败 verdict 也记录（短 TTL，便于排障）。 */
export async function publishAggregateVerdict(
  organizationId: string,
  workspaceId: string,
  domain: string,
  verdict: AggregateVerdict,
  deps: { redis?: RedisLike | null } = {},
): Promise<boolean> {
  const c = deps.redis !== undefined ? (deps.redis ?? undefined) : resolved();
  if (!c) return false;
  try {
    await c.set(aggregateVerdictKey(organizationId, workspaceId, domain), JSON.stringify(verdict), "EX", AGG_VERDICT_TTL_SECONDS);
    return true;
  } catch { return false; }
}

/**
 * 读取 verdict。任何异常、缺失、格式错误都返回 null（=未对账→走 live），fail-open。
 */
export async function readAggregateVerdict(
  organizationId: string,
  workspaceId: string,
  domain: string,
  deps: { redis?: RedisLike | null } = {},
): Promise<AggregateVerdict | null> {
  const c = deps.redis !== undefined ? (deps.redis ?? undefined) : resolved();
  if (!c) return null;
  try {
    return parseVerdict(await c.get(aggregateVerdictKey(organizationId, workspaceId, domain)));
  } catch { return null; }
}

/** 该域是否已被对账确认为可安全切读。 */
export async function aggregateCutoverReady(
  organizationId: string,
  workspaceId: string,
  domain: string,
): Promise<boolean> {
  const verdict = await readAggregateVerdict(organizationId, workspaceId, domain);
  return verdict?.ok === true;
}
