import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function readPositiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);

  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function getPrismaClient() {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to initialize Prisma.");
  }

  // P1-3: 显式连接池。adapter 模式下 datasource 不接受 url/连接参数，池配置只能在应用层。
  // 默认值贴近 pg 默认(max=10)，50 人规模下可由 PRISMA_POOL_MAX 上调；超时防止并发排队时无限等待。
  const pool = new Pool({
    connectionString,
    max: readPositiveIntegerEnv("PRISMA_POOL_MAX", 10),
    idleTimeoutMillis: readPositiveIntegerEnv("PRISMA_POOL_IDLE_TIMEOUT_MS", 30_000),
    connectionTimeoutMillis: readPositiveIntegerEnv("PRISMA_POOL_CONNECT_TIMEOUT_MS", 10_000),
  });
  const adapter = new PrismaPg(pool);
  const prismaClient = new PrismaClient({
    adapter,
    log: process.env.ERP_PERFORMANCE_TRACE === "1" ? [{ emit: "event", level: "query" }] : [],
    transactionOptions: {
      maxWait: readPositiveIntegerEnv("PRISMA_TRANSACTION_MAX_WAIT_MS", 10_000),
      timeout: readPositiveIntegerEnv("PRISMA_TRANSACTION_TIMEOUT_MS", 30_000),
    },
  });
  if (process.env.ERP_PERFORMANCE_TRACE === "1") {
    prismaClient.$on("query", event => {
      // Hash query structure; omit SQL text, parameters, credentials and tenant identifiers.
      console.info(JSON.stringify({ event: "erp.sql", durationMs: event.duration,
        fingerprint: createHash("sha256").update(event.query).digest("hex").slice(0, 12) }));
    });
  }

  globalForPrisma.prisma = prismaClient;

  return prismaClient;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getPrismaClient(), property, receiver);
  },
});
