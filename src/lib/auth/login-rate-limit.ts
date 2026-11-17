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
  /** account-wide failures allowed across all IPs inside the window */
  perAccount: 20,
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
  // >= so the (limit+1)-th attempt cannot reach password verification or the DB.
  if (count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/** Redis 键只保存 SHA256 摘要，不保存明文邮箱或 IP；该摘要未加盐。 */
export function loginRateLimitKeys(ip: string, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  return {
    identity: `auth:login:identity:${digest(`${ip}\0${normalizedEmail}`)}`,
    ip: `auth:login:ip:${digest(ip)}`,
    // Independent account-wide bucket: catches credential stuffing spread
    // across many IPs that neither the identity nor the ip bucket can see.
    account: `auth:login:account:${digest(normalizedEmail)}`,
  };
}

/** Minimal alert: log a hashed account id at most once per window. */
const accountAlerts = new Map<string, number>();
function warnAccountLocked(email: string) {
  const key = digest(email.trim().toLowerCase());
  const now = Date.now();
  if (now - (accountAlerts.get(key) ?? 0) < loginRateLimit.windowSeconds * 1000) return;
  if (accountAlerts.size >= 20_000) accountAlerts.clear();
  accountAlerts.set(key, now);
  console.warn(`[auth] 账号登录失败次数已达上限（account=${key.slice(0, 12)}）`);
}

type Counter = { count: number; pttl: number };
function combineVerdicts(identity: Counter, byIp: Counter, byAccount: Counter, email: string): RateLimitVerdict {
  const accountVerdict = evaluateRateLimit(byAccount.count, byAccount.pttl, loginRateLimit.perAccount, loginRateLimit.windowSeconds);
  if (!accountVerdict.allowed) warnAccountLocked(email);
  const verdicts = [
    evaluateRateLimit(identity.count, identity.pttl, loginRateLimit.perIdentity, loginRateLimit.windowSeconds),
    evaluateRateLimit(byIp.count, byIp.pttl, loginRateLimit.perIp, loginRateLimit.windowSeconds),
    accountVerdict,
  ];
  return verdicts.find(verdict => !verdict.allowed) ?? { allowed: true, retryAfterSeconds: 0 };
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
  let byAccount = memoryPeek(keys.account);
  try {
    const client = getRedis();
    if (client) {
      const [identityTtl, ipTtl, accountTtl, values] = await Promise.all([
        client.pttl(keys.identity),
        client.pttl(keys.ip),
        client.pttl(keys.account),
        client.mget([keys.identity, keys.ip, keys.account]),
      ]);
      identity = { count: Number(values[0] ?? 0), pttl: identityTtl };
      byIp = { count: Number(values[1] ?? 0), pttl: ipTtl };
      byAccount = { count: Number(values[2] ?? 0), pttl: accountTtl };
    } else {
      failClosedInProduction();
    }
  } catch {
    failClosedInProduction();
  }
  return combineVerdicts(identity, byIp, byAccount, email);
}

/**
 * Called after a failed login. Returns whether further attempts are allowed.
 * Redis is authoritative and shared across web instances; production fails
 * closed on outages, while development/test retain bounded per-process buckets.
 */
export async function recordLoginFailure(ip: string, email: string): Promise<RateLimitVerdict> {
  const keys = loginRateLimitKeys(ip, email);
  const memoryCounters = () => ({
    identity: { count: memoryIncrement(keys.identity, loginRateLimit.windowSeconds).count, pttl: 0 },
    byIp: { count: memoryIncrement(keys.ip, loginRateLimit.windowSeconds).count, pttl: 0 },
    byAccount: { count: memoryIncrement(keys.account, loginRateLimit.windowSeconds).count, pttl: 0 },
  });
  try {
    const client = getRedis();
    if (client) {
      const [identity, byIp, byAccount] = await Promise.all([
        incrementWithRedis(client, keys.identity, loginRateLimit.windowSeconds),
        incrementWithRedis(client, keys.ip, loginRateLimit.windowSeconds),
        incrementWithRedis(client, keys.account, loginRateLimit.windowSeconds),
      ]);
      return combineVerdicts(identity, byIp, byAccount, email);
    }
    failClosedInProduction();
    const { identity, byIp, byAccount } = memoryCounters();
    return combineVerdicts(identity, byIp, byAccount, email);
  } catch (error) {
    if (error instanceof LoginRateLimitUnavailableError) throw error;
    failClosedInProduction();
    const { identity, byIp, byAccount } = memoryCounters();
    return combineVerdicts(identity, byIp, byAccount, email);
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
  // A successful sign-in clears the account-wide bucket too, so a legitimate
  // owner is not locked out by attacks that targeted their account.
  memoryReset(keys.account);
  try {
    const client = getRedis();
    if (!client) return;
    await Promise.all([client.del(keys.identity), client.del(keys.account)]);
  } catch {
    // Redis outage must not invalidate a successful sign-in.
  }
}
