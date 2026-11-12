import { prisma } from "@/lib/db/prisma";
import { wmsEventConsumers, type WmsEventConsumer } from "./event-consumers";

export const wmsEventMaxAttempts = 10;
const retryDelay = (attempts: number) => Math.min(15 * 60_000, 1000 * 2 ** Math.min(attempts, 10));

function registry(consumers: readonly WmsEventConsumer[]) {
  const entries = new Map(consumers.map(consumer => [consumer.id, consumer]));
  if (entries.size !== consumers.length || consumers.some(consumer => !consumer.id || !consumer.eventType || !Number.isSafeInteger(consumer.schemaVersion) || consumer.schemaVersion < 1)) throw Error("Invalid WMS consumer registry");
  return entries;
}

/** Backfills missing receipts as well as rebuilding lost Redis jobs. Bounded per consumer. */
export async function pendingWmsEventDeliveries(consumers: readonly WmsEventConsumer[] = wmsEventConsumers) {
  registry(consumers);
  const deliveries: Array<{ id: string; attempts: number }> = [];
  for (const consumer of consumers) {
    const events = await prisma.wmsDomainEvent.findMany({
      where: { eventType: consumer.eventType, schemaVersion: consumer.schemaVersion, deliveries: { none: { consumerId: consumer.id } } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 50,
      select: { id: true, organizationId: true, workspaceId: true },
    });
    if (events.length) await prisma.wmsEventDelivery.createMany({ skipDuplicates: true, data: events.map(event => ({
      id: crypto.randomUUID(), eventId: event.id, organizationId: event.organizationId, workspaceId: event.workspaceId, consumerId: consumer.id,
    })) });
    deliveries.push(...await prisma.wmsEventDelivery.findMany({
      where: { consumerId: consumer.id, processedAt: null, attempts: { lt: wmsEventMaxAttempts }, availableAt: { lte: new Date() },
        event: { eventType: consumer.eventType, schemaVersion: consumer.schemaVersion } },
      orderBy: [{ availableAt: "asc" }, { id: "asc" }], take: 50, select: { id: true, attempts: true },
    }));
  }
  return deliveries;
}

/** The row lock, handler effects and acknowledgement share one local transaction. */
export async function processWmsEventDelivery(deliveryId: string, consumers: readonly WmsEventConsumer[] = wmsEventConsumers) {
  const handlers = registry(consumers);
  let attempt: { id: string; attempts: number } | undefined;
  try {
    return await prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "WmsEventDelivery" WHERE id=${deliveryId} FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return "skipped" as const;
      const delivery = await tx.wmsEventDelivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { event: true } });
      if (delivery.processedAt || delivery.attempts >= wmsEventMaxAttempts || delivery.availableAt > new Date()) return "skipped" as const;
      const consumer = handlers.get(delivery.consumerId);
      if (!consumer || consumer.eventType !== delivery.event.eventType || consumer.schemaVersion !== delivery.event.schemaVersion) return "skipped" as const;
      attempt = { id: delivery.id, attempts: delivery.attempts };
      await consumer.handle(tx, delivery.event);
      await tx.wmsEventDelivery.update({ where: { id: delivery.id }, data: { attempts: { increment: 1 }, processedAt: new Date(), lastError: null } });
      return "processed" as const;
    });
  } catch (error) {
    if (attempt) await prisma.wmsEventDelivery.updateMany({
      // A racing successful handler or a newer failed attempt must not be overwritten.
      where: { id: attempt.id, attempts: attempt.attempts, processedAt: null },
      data: { attempts: { increment: 1 }, availableAt: new Date(Date.now() + retryDelay(attempt.attempts + 1)), lastError: "WMS_EVENT_CONSUMER_FAILED" },
    });
    throw error;
  }
}
