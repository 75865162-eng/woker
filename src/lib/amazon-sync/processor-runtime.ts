import type { Prisma, PrismaClient, AmazonSyncRun } from '@prisma/client';
import type { AmazonRequestEvent } from '@/lib/amazon/sp-api-client';
import type { SyncScope } from './policy';

export type SyncProcessorSource = Prisma.AmazonSyncDataSourceGetPayload<{ include: { authorization: true; seller: true } }>;

export type SyncProcessorRuntime = {
  prisma: PrismaClient;
  leaseMs: number;
  maxPages: number;
  maxRows: number;
  scopeLock: (tx: Prisma.TransactionClient, scope: SyncScope) => Promise<void>;
  assertActor: (run: AmazonSyncRun) => Promise<void>;
  assertFence: (tx: Prisma.TransactionClient, run: AmazonSyncRun) => Promise<AmazonSyncRun>;
  assertLiveSource: (tx: Prisma.TransactionClient, run: AmazonSyncRun) => Promise<SyncProcessorSource>;
  stopForControl: (tx: Prisma.TransactionClient, run: AmazonSyncRun) => Promise<boolean>;
  yieldSlice: (run: AmazonSyncRun, nextAttemptAt?: Date) => Promise<void>;
  log: (tx: Prisma.TransactionClient, run: AmazonSyncRun, event: string, code?: string) => Promise<void>;
  persistRequests: (run: AmazonSyncRun, events: AmazonRequestEvent[], key: SyncScope & { authorizationId: string; operation: string }, error?: unknown) => Promise<void>;
  persistOrderRequests: (run: AmazonSyncRun, events: AmazonRequestEvent[], bucketKey: string, configuredRate: number, now: Date, error?: unknown) => Promise<void>;
  fenceLost: () => Error;
  preflightRejected: (message: string) => Error;
};
