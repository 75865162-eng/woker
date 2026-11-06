import { createHmac } from "node:crypto";

/** Server-only comparison token. No credentials, hosts or tokens are returned. */
export function connectionIdentity(env: Record<string, string | undefined> = process.env): string | null {
  if (!env.AUTH_SECRET || !env.DATABASE_URL || !env.REDIS_URL) return null;
  try {
    const database = new URL(env.DATABASE_URL);
    const redis = new URL(env.REDIS_URL);
    if (!["postgres:", "postgresql:"].includes(database.protocol) || !["redis:", "rediss:"].includes(redis.protocol)) return null;
    const target = [
      [database.hostname.toLowerCase(), database.port || "5432", database.pathname],
      [redis.protocol, redis.hostname.toLowerCase(), redis.port || "6379", redis.pathname === "/" || !redis.pathname ? "/0" : redis.pathname],
      env.QUEUE_DRIVER ?? "inline",
    ];
    return createHmac("sha256", env.AUTH_SECRET).update(JSON.stringify(target)).digest("hex");
  } catch { return null; }
}

/** Keep comparison tokens internal when returning legacy heartbeat metadata. */
export function publicHeartbeatMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const metadata = { ...value } as Record<string, unknown>;
  delete metadata.connectionIdentity;
  return metadata;
}
