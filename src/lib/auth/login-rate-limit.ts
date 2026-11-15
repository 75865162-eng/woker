import { createHash } from "node:crypto";
// Static import: Next's webpack server bundle cannot resolve createRequire() /
// import.meta.url at module-evaluation time (it fails while collecting page data).
// ioredis is the same client BullMQ uses, declared as a direct dependency.
import RedisClient from "ioredis";

const Redis = RedisClient as unknown as new (
  url: string,
  options: Record<string, unknown>,
) => {
  eval(script: string, keys: number, ...args: Array<string | number>): Promise<unknown>;
  mget(keys: string[]): Promise<Array<string | null>>;
  pttl(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  del(key: string): Promise<number>;
  on(event: string, listener: () => void): void;
};

export const loginRateLimit = {
  /** failures allowed for one ip+email pair inside the window */
  perIdentity: 8,
  /** failures allowed from one ip across all accounts inside the window */
  perIp: 30,
  windowSeconds: 15 * 60,
} as const;

type Bucket = { count: number; resetAt: number };
export type RateLimitVerdict = { allowed: boolean; retryAfterSeconds: number };

/** Shared login protection is required in production; an outage is not a spent budget. */
export class LoginRateLimitUnavailableError extends Error {
  readonly retryAfterSeconds = 5;

  constructor() {
    super("登录保护暂时不可用，请稍后重试。");
    this.name = "LoginRateLimitUnavailableError";
  }
}

function failClosedInProduction() {
  if (process.env.NODE_ENV === "production") throw new LoginRateLimitUnavailableError();
}

/** Pure decision function, kept separate from IO so it can be unit tested. */
export function evaluateRateLimit(count: number, pttlMillis: number, limit: number, windowSeconds: number): RateLimitVerdict {
  const ttl = pttlMillis > 0 ? pttlMillis : windowSeconds * 1000;
  if (count > limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/** Redis 键只保存 SHA256 摘要，不保存明文邮箱或 IP；该摘要未加盐。 */
export function loginRateLimitKeys(ip: string, email: string) {
  return {
    identity: `auth:login:identity:${digest(`${ip}\0${email}`)}`,
    ip: `auth:login:ip:${digest(ip)}`,
  };
}

const memory = new Map<string, Bucket>();
const memoryLimit = 20_000;

function memoryIncrement(key: string, windowSeconds: number): { count: number; pttl: number } {
  const now = Date.now();
  const existing = memory.get(key);
  let bucket = existing;
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowSeconds * 1000 };
  }
  bucket.count += 1;
  if (memory.size >= memoryLimit) {
    for (const [candidate, value] of memory) {
      if (value.resetAt <= now) memory.delete(candidate);
    }
    if (memory.size >= memoryLimit) memory.delete(memory.keys().next().value as string);
  }
  memory.set(key, bucket);
  return { count: bucket.count, pttl: bucket.resetAt - now };
}

function memoryReset(key: string) {
  memory.delete(key);
}

let redis: InstanceType<typeof Redis> | undefined;
let injectedRedis: InstanceType<typeof Redis> | null | undefined;
export function setLoginRateLimitRedisForTest(client: InstanceType<typeof Redis> | null | undefined) {
  injectedRedis = client;
}

function getRedis() {
  if (injectedRedis !== undefined) return injectedRedis ?? undefined;
  const url = process.env.REDIS_URL;
  if (!url) return undefined;
  if (!redis) {
    redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      commandTimeout: 500,
      connectTimeout: 1000,
      retryStrategy: () => null,
    });
    redis.on("error", () => {});
  }
  return redis;
}

async function incrementWithRedis(client: NonNullable<ReturnType<typeof getRedis>>, key: string, windowSeconds: number) {
  const result = await client.eval(`
    local count = redis.call('INCR', KEYS[1])
    if redis.call('PTTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
    return {count, redis.call('PTTL', KEYS[1])}
  `, 1, key, windowSeconds) as [number, number];
  return { count: Number(result[0]), pttl: Number(result[1]) };
}

function memoryPeek(key: string): { count: number; pttl: number } {
  const now = Date.now();
  const bucket = memory.get(key);
  if (!bucket || bucket.resetAt <= now) return { count: 0, pttl: 0 };
  return { count: bucket.count, pttl: bucket.resetAt - now };
}

/**
 * Non-mutating pre-check so a blocked client is rejected before running scrypt
 * or querying the database. Read-only; never creates a Redis key.
 */
export async function peekLoginRateLimit(ip: string, email: string): Promise<RateLimitVerdict> {
  const keys = loginRateLimitKeys(ip, email);
  let identity = memoryPeek(keys.identity);
  let byIp = memoryPeek(keys.ip);
  try {
    const client = getRedis();
    if (client) {
      const [identityTtl, ipTtl, values] = await Promise.all([
        client.pttl(keys.identity),
        client.pttl(keys.ip),
        client.mget([keys.identity, keys.ip]),
      ]);
      identity = { count: Number(values[0] ?? 0), pttl: identityTtl };
      byIp = { count: Number(values[1] ?? 0), pttl: ipTtl };
    } else {
      failClosedInProduction();
    }
  } catch {
    failClosedInProduction();
  }
  const verdicts = [
    evaluateRateLimit(identity.count, identity.pttl, loginRateLimit.perIdentity, loginRateLimit.windowSeconds),
    evaluateRateLimit(byIp.count, byIp.pttl, loginRateLimit.perIp, loginRateLimit.windowSeconds),
  ];
  return verdicts.find(verdict => !verdict.allowed) ?? { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Called after a failed login. Returns whether further attempts are allowed.
 * Redis is authoritative and shared across web instances; production fails
 * closed on outages, while development/test retain bounded per-process buckets.
 */
export async function recordLoginFailure(ip: string, email: string): Promise<RateLimitVerdict> {
  const keys = loginRateLimitKeys(ip, email);
  try {
    const client = getRedis();
    if (client) {
      const [identity, byIp] = await Promise.all([
        incrementWithRedis(client, keys.identity, loginRateLimit.windowSeconds),
        incrementWithRedis(client, keys.ip, loginRateLimit.windowSeconds),
      ]);
      const verdicts = [
        evaluateRateLimit(identity.count, identity.pttl, loginRateLimit.perIdentity, loginRateLimit.windowSeconds),
        evaluateRateLimit(byIp.count, byIp.pttl, loginRateLimit.perIp, loginRateLimit.windowSeconds),
      ];
      const blocked = verdicts.find(verdict => !verdict.allowed);
      return blocked ?? { allowed: true, retryAfterSeconds: 0 };
    }
    failClosedInProduction();
    const verdicts = [
      evaluateRateLimit(memoryIncrement(keys.identity, loginRateLimit.windowSeconds).count, 0, loginRateLimit.perIdentity, loginRateLimit.windowSeconds),
      evaluateRateLimit(memoryIncrement(keys.ip, loginRateLimit.windowSeconds).count, 0, loginRateLimit.perIp, loginRateLimit.windowSeconds),
    ];
    const blocked = verdicts.find(verdict => !verdict.allowed);
    return blocked ?? { allowed: true, retryAfterSeconds: 0 };
  } catch (error) {
    if (error instanceof LoginRateLimitUnavailableError) throw error;
    failClosedInProduction();
    const verdicts = [
      evaluateRateLimit(memoryIncrement(keys.identity, loginRateLimit.windowSeconds).count, 0, loginRateLimit.perIdentity, loginRateLimit.windowSeconds),
      evaluateRateLimit(memoryIncrement(keys.ip, loginRateLimit.windowSeconds).count, 0, loginRateLimit.perIp, loginRateLimit.windowSeconds),
    ];
    const blocked = verdicts.find(verdict => !verdict.allowed);
    return blocked ?? { allowed: true, retryAfterSeconds: 0 };
  }
}

/**
 * Called after a successful login. Only the identity counter is reset: clearing
 * the IP-wide counter would let an attacker with one valid account repeatedly
 * wipe the shared-IP budget and keep guessing other accounts.
 */
export async function clearLoginFailures(ip: string, email: string): Promise<void> {
  const keys = loginRateLimitKeys(ip, email);
  memoryReset(keys.identity);
  try {
    const client = getRedis();
    if (!client) return;
    await client.del(keys.identity);
  } catch {
    // Redis outage must not invalidate a successful sign-in.
  }
}
