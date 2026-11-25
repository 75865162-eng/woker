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
 * - verdict 带 org+ws+domain+SCHEMA_VERSION 隔离，跨租户/跨域/跨 schema 版本不串；
 * - 只有 reconcile 脚本确认 0-diff 后才写入 ok=true；任何 diff 都不会发布 ok；
 * - verdict 有 TTL，过期自动回到 live；schema 版本变化时旧 verdict 立即失效（见下）。
 *
 * 报告1 阶段0 P1：verdict key 增加 schema 版本。此前 7 天 TTL 的 ok verdict 在
 * 聚合表 schema 变更/回填后仍可能存活并误放行。现在 key 与 verdict 体都绑定
 * AGG_SCHEMA_VERSION，schema 变更时只需 bump 该常量（或设置 env），旧版本 verdict
 * 因 key 不同而读不到 → fail-closed 走 live，直到重新对账发布新版本 verdict。
 */
import RedisClient from "ioredis";

export const AGG_VERDICT_PREFIX = "sellfox:agg-verdict:";
export const AGG_VERDICT_TTL_SECONDS = 7 * 24 * 3600;

/**
 * 聚合口径/表结构版本。任何影响「源表↔聚合表对账结果」的变更（字段增删/口径调整/
 * 回填）都必须递增它。默认 v1，可由 SELLFOX_AGG_SCHEMA_VERSION 覆盖，便于发布时
 * 主动作废旧 verdict 而无需改代码。
 */
export const AGG_SCHEMA_VERSION = (process.env.SELLFOX_AGG_SCHEMA_VERSION || "v1").trim() || "v1";

export type AggregateVerdict = {
  ok: boolean;
  at: string;
  sourceRows: number;
  aggregateRows: number;
  /** verdict 发布时Stamp的 schema 版本；缺失/不符一律视为未对账。 */
  schemaVersion?: string;
};

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

/**
 * verdict key：{prefix}{org}:{ws}:{domain}:{schemaVersion}。
 * 保留 schemaVersion 可选参数，默认取当前 AGG_SCHEMA_VERSION；测试可显式传旧版本验证隔离。
 */
export function aggregateVerdictKey(
  organizationId: string,
  workspaceId: string,
  domain: string,
  schemaVersion: string = AGG_SCHEMA_VERSION,
): string {
  return `${AGG_VERDICT_PREFIX}${organizationId}:${workspaceId}:${domain}:${schemaVersion}`;
}

/**
 * 解析 verdict。任何异常、缺失、格式错误、schema 版本不符都返回 null（=未对账→走 live）。
 * expectedVersion 默认当前版本；旧记录缺 schemaVersion 或版本不同一律拒绝（fail-closed）。
 */
export function parseVerdict(raw: string | null, expectedVersion: string = AGG_SCHEMA_VERSION): AggregateVerdict | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as AggregateVerdict;
    if (typeof value?.ok !== "boolean" || typeof value?.at !== "string") return null;
    if (value.schemaVersion !== expectedVersion) return null;
    return value;
  } catch { return null; }
}

/** 写入 verdict。仅当 ok=true 时按策略设置 TTL；无论 ok 与否都Stamp当前 schema 版本。 */
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
    const stamped: AggregateVerdict = { ...verdict, schemaVersion: AGG_SCHEMA_VERSION };
    await c.set(aggregateVerdictKey(organizationId, workspaceId, domain), JSON.stringify(stamped), "EX", AGG_VERDICT_TTL_SECONDS);
    return true;
  } catch { return false; }
}

/**
 * 读取 verdict。任何异常、缺失、格式错误、版本不符都返回 null（=未对账→走 live），fail-open。
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

/** 该域是否已被对账确认为可安全切读（且 schema 版本一致）。 */
export async function aggregateCutoverReady(
  organizationId: string,
  workspaceId: string,
  domain: string,
): Promise<boolean> {
  const verdict = await readAggregateVerdict(organizationId, workspaceId, domain);
  return verdict?.ok === true;
}

/**
 * 主动作废旧版本 verdict（schema 变更发布时调用）：删除 org/ws 下所有 domain 的所有版本 key。
 * 只做精确前缀 SCAN+DEL，避免 KEYS 阻塞。
 */
export async function invalidateAggregateVerdicts(
  organizationId: string,
  workspaceId: string,
  deps: { redis?: RedisLike | null } = {},
): Promise<number> {
  const c = deps.redis !== undefined ? (deps.redis ?? undefined) : resolved();
  if (!c) return 0;
  const scan = (c as unknown as {
    scan?: (cursor: string, match: string, count: number, cb: (e: Error | null, r: [string, string[]]) => void) => void;
    del?: (...keys: string[]) => Promise<number>;
  });
  if (!scan.scan || !scan.del) return 0;
  const pattern = `${AGG_VERDICT_PREFIX}${organizationId}:${workspaceId}:*`;
  const prefix = `${AGG_VERDICT_PREFIX}${organizationId}:${workspaceId}:`;
  let cursor = "0";
  let removed = 0;
  try {
    do {
      const [next, keys] = await new Promise<[string, string[]]>((resolve, reject) => {
        scan.scan!(cursor, pattern, 200, (err, res) => (err ? reject(err) : resolve(res)));
      });
      cursor = next;
      // 双重校验前缀，防止 SCAN 匹配放宽导致误删
      const safe = keys.filter((k) => k.startsWith(prefix));
      if (safe.length) removed += await scan.del!(...safe);
    } while (cursor !== "0");
  } catch { /* fail-open：清理由发布流程重试，读侧仍 fail-closed */ }
  return removed;
}
