import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

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

  const adapter = new PrismaPg({ connectionString });
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
