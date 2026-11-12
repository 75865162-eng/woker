import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { SyncScope } from '@/lib/amazon-sync/policy';
import { amazonBusinessData } from '@/lib/amazon-sync/business-data';
import { adsBusinessFingerprint } from './change-contract';

/** Observed snapshot changes; never claims to cover changes made between observations. */
export async function recordAdsEntityObservation(tx: Prisma.TransactionClient, input: { scope: SyncScope; profileId: string; entityType: string; externalId: string; sourceTaskId: string; before: Prisma.JsonValue; after: Prisma.JsonValue }) {
  const before = input.before == null ? null : amazonBusinessData(input.before), after = amazonBusinessData(input.after);
  if (before !== null && adsBusinessFingerprint(before) === adsBusinessFingerprint(after)) return;
  const observationHash = adsBusinessFingerprint({ before, after });
  await tx.amazonAdsEntityHistory.createMany({ data: [{ id: randomUUID(), ...input.scope, profileId: input.profileId, entityType: input.entityType, externalId: input.externalId, sourceTaskId: input.sourceTaskId, before: before === null ? Prisma.DbNull : before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue, observationHash }], skipDuplicates: true });
}
